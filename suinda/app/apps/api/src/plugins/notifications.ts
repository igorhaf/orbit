import { HttpException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { Db } from "../db";
import { PluginDefinition } from "./contract";
import type { AuthMailer } from "../access/auth-lifecycle";
import { productWebOrigin } from "../product-profile";
import webpush from "web-push";
import { renderWorkspaceEmailTemplate, type WorkspaceEmailTemplateField } from "./workspace-email-templates";
import { pinnedHttpsAgent, resolvePublicHttpsTarget, UnsafeHttpsTargetError } from "../secure-https-target";

type PushSubscriptionInput = { endpoint: string; expirationTime?: number | null; keys: { p256dh: string; auth: string } };

function vapidConfiguration() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject || !/^(?:https:\/\/|mailto:)/i.test(subject)) return null;
  try { webpush.setVapidDetails(subject, publicKey, privateKey); }
  catch { return null; }
  return { publicKey, privateKey, subject };
}

function validPushEndpoint(endpoint: string) {
  try {
    const parsed = new URL(endpoint);
    return parsed.protocol === "https:" && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch { return false; }
}
function truncateUtf8(value: string, limit: number) {
  return Buffer.from(value, "utf8").subarray(0, limit).toString("utf8").replace(/\uFFFD$/, "");
}

export const cardNotificationPlugin: PluginDefinition = {
  id: "cards", name: "Cartões", version: "1.0.0",
  contributions: { notifications: [
    { id: "assignment", label: "Atribuições" },
    { id: "comment", label: "Comentários" },
    { id: "mention", label: "Menções" },
    { id: "card_updated", label: "Atualizações de cartão" },
    { id: "card_execution", label: "Execuções de cartão" },
  ] },
};

export type PluginNotificationInput = {
  kind: string;
  title: string;
  body?: string;
  boardId?: string | null;
  cardId?: string | null;
  targetUrl?: string | null;
  dueAt?: string | null;
  workspaceId?: string | null;
};

export type PublishedPluginNotification = {
  id: string;
  plugin_id: string;
  user_id: string;
  workspace_id: string | null;
  kind: string;
  title: string;
  body: string;
  target_url: string | null;
  created_at: string;
};
export type PluginNotificationObserver = (notification: PublishedPluginNotification) => Promise<void>;

@Injectable()
export class PluginNotifications implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PluginNotifications.name);
  private emailTimer: NodeJS.Timeout | null = null;
  private pushTimer: NodeJS.Timeout | null = null;
  private readonly observers = new Set<PluginNotificationObserver>();

  constructor(@Inject(Db) private readonly db: Db, @Optional() @Inject("AUTH_MAILER") private readonly mailer?: AuthMailer) {}

  registerDeliveryObserver(observer: PluginNotificationObserver) {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  onModuleInit() {
    this.emailTimer = setInterval(() => this.runNotificationEmailWorker(), 60_000);
    this.emailTimer.unref();
    this.runNotificationEmailWorker();
    this.pushTimer = setInterval(() => this.runNotificationPushWorker(), 30_000);
    this.pushTimer.unref();
    this.runNotificationPushWorker();
  }

  onModuleDestroy() {
    if (this.emailTimer) clearInterval(this.emailTimer);
    if (this.pushTimer) clearInterval(this.pushTimer);
  }

  pushConfig(userId: string) {
    const configuration = vapidConfiguration();
    return this.db.one<{ subscribed: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM notification_push_subscriptions WHERE user_id=$1) AS subscribed", [userId],
    ).then((row) => ({ enabled: Boolean(configuration), public_key: configuration?.publicKey || null, subscribed: Boolean(row?.subscribed) }));
  }

  async subscribePush(userId: string, input: unknown) {
    if (!vapidConfiguration()) throw new HttpException({ message: "Notificações push indisponíveis." }, 503);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpException({ message: "Inscrição push inválida." }, 400);
    const value = input as Partial<PushSubscriptionInput>;
    const keys = value.keys;
    if (typeof value.endpoint !== "string" || value.endpoint.length > 2048 || !validPushEndpoint(value.endpoint) ||
      !keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string" ||
      keys.p256dh.length < 20 || keys.p256dh.length > 200 || keys.auth.length < 8 || keys.auth.length > 100 ||
      !/^[A-Za-z0-9_-]+$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]+$/.test(keys.auth)) {
      throw new HttpException({ message: "Inscrição push inválida." }, 400);
    }
    try { await resolvePublicHttpsTarget(value.endpoint); }
    catch { throw new HttpException({ message: "Inscrição push inválida." }, 400); }
    try {
      if (Buffer.from(keys.p256dh, "base64url").length !== 65 || Buffer.from(keys.auth, "base64url").length !== 16)
        throw new Error("Invalid push keys");
    } catch { throw new HttpException({ message: "Inscrição push inválida." }, 400); }
    const stored = await this.db.one<{ user_id: string }>(
      `INSERT INTO notification_push_subscriptions(user_id,endpoint,p256dh,auth)
       VALUES($1,$2,$3,$4) ON CONFLICT(endpoint) DO UPDATE
       SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,updated_at=now()
       WHERE notification_push_subscriptions.user_id=EXCLUDED.user_id
       RETURNING user_id`,
      [userId, value.endpoint, keys.p256dh, keys.auth],
    );
    if (!stored) throw new HttpException({ message: "Este dispositivo já está associado a outra conta." }, 409);
    return { ok: true };
  }

  async unsubscribePush(userId: string, endpoint: unknown) {
    if (typeof endpoint !== "string" || endpoint.length > 2048 || !validPushEndpoint(endpoint)) throw new HttpException({ message: "Inscrição push inválida." }, 400);
    await this.db.query("DELETE FROM notification_push_subscriptions WHERE user_id=$1 AND endpoint=$2", [userId, endpoint]);
    return { ok: true };
  }

  private runNotificationPushWorker() {
    void this.dispatchNotificationPushes().catch((error: unknown) => {
      this.logger.error(`Não foi possível processar a fila push (${error instanceof Error ? error.name : "erro"}).`);
    });
  }

  async dispatchNotificationPushes() {
    await this.db.query(
      `UPDATE notification_push_deliveries SET status='failed',updated_at=now()
       WHERE status='sending' AND attempt_count>=5 AND updated_at<=now()-INTERVAL '5 minutes'`,
    );
    const vapid = vapidConfiguration();
    if (!vapid) {
      await this.db.query("UPDATE notification_push_deliveries SET status='cancelled',updated_at=now() WHERE status='pending'");
      return;
    }
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    const due = await this.db.query<{
      id: string; subscription_id: string; user_id: string; attempt_count: number; endpoint: string; p256dh: string; auth: string;
      title: string; body: string; target_url: string | null;
    }>(
      `WITH due AS (
         SELECT d.id FROM notification_push_deliveries d
         JOIN notification_push_subscriptions s ON s.id=d.subscription_id
         JOIN users u ON u.id=d.user_id
         WHERE (d.status='pending' AND d.available_at<=now()
             OR d.status='sending' AND d.updated_at<=now()-INTERVAL '5 minutes')
           AND d.attempt_count<5 AND u.disabled=false
           AND COALESCE((u.preferences->>'notifications')::boolean,true)
         ORDER BY d.available_at,d.created_at LIMIT 25 FOR UPDATE OF d SKIP LOCKED
       )
       UPDATE notification_push_deliveries d
       SET status='sending',attempt_count=d.attempt_count+1,updated_at=now()
       FROM due,notifications n,notification_push_subscriptions s,users u
       WHERE d.id=due.id AND n.id=d.notification_id AND s.id=d.subscription_id AND u.id=d.user_id
       RETURNING d.id,d.subscription_id,d.user_id,d.attempt_count,s.endpoint,s.p256dh,s.auth,n.title,n.body,n.target_url`,
    );
    for (const delivery of due) {
      try {
        const stillEnabled = await this.db.one<{ enabled: boolean }>(
          `SELECT COALESCE((preferences->>'notifications')::boolean,true) AS enabled
           FROM users WHERE id=$1 AND disabled=false`, [delivery.user_id],
        );
        if (!stillEnabled?.enabled) {
          await this.db.query("UPDATE notification_push_deliveries SET status='cancelled',updated_at=now() WHERE id=$1 AND status='sending'", [delivery.id]);
          continue;
        }
        const origin = productWebOrigin().replace(/\/$/, "");
        const target = delivery.target_url && delivery.target_url.startsWith("/") && !delivery.target_url.startsWith("//") ? delivery.target_url.slice(0, 600) : "/";
        const payload = JSON.stringify({ title: truncateUtf8(delivery.title, 240), body: truncateUtf8(delivery.body, 1500), url: truncateUtf8(`${origin}${target}`, 1200) });
        if (Buffer.byteLength(payload, "utf8") > 3500) throw new Error("Push payload limit exceeded");
        const pinnedTarget = await resolvePublicHttpsTarget(delivery.endpoint);
        const agent = pinnedHttpsAgent(pinnedTarget);
        try {
          await webpush.sendNotification({ endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth } }, payload, { TTL: 3600, agent });
        } finally { agent.destroy(); }
        await this.db.query("UPDATE notification_push_deliveries SET status='sent',sent_at=now(),updated_at=now() WHERE id=$1 AND status='sending'", [delivery.id]);
      } catch (error) {
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? Number((error as { statusCode?: unknown }).statusCode) : 0;
        if (statusCode === 404 || statusCode === 410) {
          await this.db.query("DELETE FROM notification_push_subscriptions WHERE id=$1", [delivery.subscription_id]);
          continue;
        }
        const retryable = !(error instanceof UnsafeHttpsTargetError) && (statusCode === 0 || statusCode === 429 || statusCode >= 500);
        const retryAtSeconds = Math.min(3600, 60 * 2 ** Math.max(0, delivery.attempt_count - 1));
        const nextStatus = !retryable || delivery.attempt_count >= 5 ? "failed" : "pending";
        await this.db.query(
          "UPDATE notification_push_deliveries SET status=$2,available_at=now()+($3::int * INTERVAL '1 second'),updated_at=now() WHERE id=$1 AND status='sending'",
          [delivery.id, nextStatus, retryAtSeconds],
        );
        this.logger.warn(`Entrega push ${delivery.id} ${nextStatus === "failed" ? "esgotou as tentativas" : "será repetida"} (${error instanceof Error ? error.name : "erro"}).`);
      }
    }
  }

  private runNotificationEmailWorker() {
    void this.dispatchNotificationEmails().catch((error: unknown) => {
      this.logger.error(`Não foi possível processar a fila de e-mails (${error instanceof Error ? error.name : "erro"}).`);
    });
  }

  async dispatchNotificationEmails() {
    await this.db.query(
      `UPDATE notification_email_deliveries SET status='failed',updated_at=now()
       WHERE status='sending' AND attempt_count>=5 AND updated_at<=now()-INTERVAL '5 minutes'`,
    );
    if (!this.mailer?.sendMessage) return;
    const deliveries = await this.db.query<{
      id: string; user_id: string; attempt_count: number; notification_plugin_id: string; kind: string; title: string; body: string;
      target_url: string | null; email: string; name: string; workspace_id: string | null; institution_name: string | null;
      template_subject: string | null; template_body: string | null;
    }>(
      `WITH due AS (
         SELECT d.id FROM notification_email_deliveries d
         JOIN notifications n ON n.id=d.notification_id
         JOIN users u ON u.id=d.user_id
         WHERE (d.status='pending' AND d.available_at<=now()
             OR d.status='sending' AND d.updated_at<=now()-INTERVAL '5 minutes')
           AND d.attempt_count<5 AND u.disabled=false AND u.email_verified=true
           AND COALESCE((u.preferences->>'notifications')::boolean,true)
           AND COALESCE((u.preferences->>'emailNotifications')::boolean,false)
         ORDER BY d.available_at,d.created_at
         LIMIT 25 FOR UPDATE OF d SKIP LOCKED
       )
       UPDATE notification_email_deliveries d
       SET status='sending',attempt_count=d.attempt_count+1,updated_at=now()
       FROM due,notifications n,users u
       WHERE d.id=due.id AND n.id=d.notification_id AND u.id=d.user_id
       RETURNING d.id,d.user_id,d.attempt_count,n.plugin_id AS notification_plugin_id,n.kind,n.title,n.body,n.target_url,u.email,u.name,
         n.workspace_id,(SELECT w.name FROM workspaces w WHERE w.id=n.workspace_id) AS institution_name,
         (SELECT t.subject_template FROM workspace_email_templates t WHERE t.workspace_id=n.workspace_id AND t.plugin_id=n.plugin_id AND t.kind=n.kind AND t.enabled=true) AS template_subject,
         (SELECT t.body_template FROM workspace_email_templates t WHERE t.workspace_id=n.workspace_id AND t.plugin_id=n.plugin_id AND t.kind=n.kind AND t.enabled=true) AS template_body`,
    );
    const origin = productWebOrigin().replace(/\/$/, "");
    for (const delivery of deliveries) {
      try {
        const account = await this.db.one<{ email: string; name: string }>(
          `SELECT email,name FROM users WHERE id=$1 AND disabled=false AND email_verified=true
           AND COALESCE((preferences->>'notifications')::boolean,true)
           AND COALESCE((preferences->>'emailNotifications')::boolean,false)`, [delivery.user_id],
        );
        if (!account) {
          await this.db.query("UPDATE notification_email_deliveries SET status='cancelled',updated_at=now() WHERE id=$1 AND status='sending'", [delivery.id]);
          continue;
        }
        const product = delivery.notification_plugin_id === "suinda-learning" ? "Suindá" : "Orbit";
        const destination = delivery.target_url ? `${origin}${delivery.target_url}` : `${origin}/profile`;
        const templateValues: Record<WorkspaceEmailTemplateField, string> = {
          learner_name: account.name || "",
          institution_name: delivery.institution_name || "",
          notification_title: delivery.title,
          notification_body: delivery.body || "",
          course_link: destination,
          product_name: product,
        };
        const rendered = delivery.notification_plugin_id === "suinda-learning" && delivery.template_subject && delivery.template_body
          ? renderWorkspaceEmailTemplate({ subject_template: delivery.template_subject, body_template: delivery.template_body }, templateValues)
          : null;
        const lines = [account.name ? `Olá, ${account.name}.` : "Olá.", "", delivery.title, delivery.body || "", "", `Abrir ${product}: ${destination}`,
          `Gerenciar notificações por e-mail: ${origin}/profile`];
        const subject = rendered?.subject || `${product}: ${delivery.title}`.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").slice(0, 250);
        await this.mailer.sendMessage([account.email], subject, rendered?.body || lines.join("\n"));
        await this.db.query("UPDATE notification_email_deliveries SET status='sent',sent_at=now(),updated_at=now() WHERE id=$1 AND status='sending'", [delivery.id]);
      } catch (error) {
        const retryAtSeconds = Math.min(3600, 60 * 2 ** Math.max(0, delivery.attempt_count - 1));
        const nextStatus = delivery.attempt_count >= 5 ? "failed" : "pending";
        await this.db.query(
          "UPDATE notification_email_deliveries SET status=$2,available_at=now()+($3::int * INTERVAL '1 second'),updated_at=now() WHERE id=$1 AND status='sending'",
          [delivery.id, nextStatus, retryAtSeconds],
        );
        this.logger.warn(`E-mail de notificação ${delivery.id} ${nextStatus === "failed" ? "esgotou as tentativas" : "será repetido"} (${error instanceof Error ? error.name : "erro"}).`);
      }
    }
  }

  async publish(pluginId: string, userId: string, input: PluginNotificationInput) {
    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(pluginId)) throw new Error("ID de plugin inválido.");
    const kind = input.kind.trim();
    const title = input.title.trim();
    const targetUrl = input.targetUrl?.trim() || null;
    const dueAt = input.dueAt?.trim() || null;
    if (!kind || kind.length > 32 || !title || title.length > 300 || (input.body?.length || 0) > 12_000) throw new Error("Notificação inválida.");
    if (targetUrl && (!targetUrl.startsWith("/") || targetUrl.startsWith("//"))) throw new Error("Destino de notificação inválido.");
    if (dueAt && !Number.isFinite(Date.parse(dueAt))) throw new Error("Prazo da notificação inválido.");
    const preferences = await this.db.one<{ enabled: boolean }>("SELECT COALESCE((preferences->>'notifications')::boolean,true) AS enabled FROM users WHERE id=$1", [userId]);
    if (!preferences?.enabled) return null;
    const notification = await this.db.one<PublishedPluginNotification>(
      `INSERT INTO notifications(plugin_id,user_id,board_id,card_id,kind,title,body,target_url,due_at,workspace_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING
       RETURNING id,plugin_id,user_id,workspace_id,kind,title,body,target_url,created_at`,
      [pluginId,userId,input.boardId || null,input.cardId || null,kind,title,input.body || "",targetUrl,dueAt,input.workspaceId || null],
    );
    if (!notification) return null;
    for (const observer of this.observers) {
      try { await observer(notification); }
      catch (error) { this.logger.warn(`Observador de notificações falhou (${error instanceof Error ? error.name : "erro"}).`); }
    }
    return notification;
  }
}
