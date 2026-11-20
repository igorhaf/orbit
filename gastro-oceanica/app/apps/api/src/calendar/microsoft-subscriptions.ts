import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Db } from "../db";
import { SecretVault } from "../secrets";
import { MicrosoftGraphClient } from "./microsoft-graph";

type Source = {
  id: string;
  owner_id: string;
  connection_id: string;
  external_id: string;
};
type Subscription = {
  id: string;
  owner_id: string;
  connection_id: string;
  source_id: string | null;
  external_id: string;
  resource: string;
  secret_encrypted: string;
  expires_at: Date;
  status: string;
};
type Notification = {
  subscriptionId?: string;
  subscriptionExpirationDateTime?: string;
  clientState?: string;
  changeType?: string;
  resource?: string;
  tenantId?: string;
  resourceData?: { id?: string; "@odata.id"?: string; "@odata.etag"?: string };
};

@Injectable()
export class MicrosoftGraphSubscriptionManager {
  readonly providerId = "microsoft";
  constructor(
    @Inject(Db) private db: Db,
    @Inject(SecretVault) private vault: SecretVault,
    @Inject(MicrosoftGraphClient) private graph: MicrosoftGraphClient,
  ) {}
  private webhook() {
    const value = process.env.MICROSOFT_GRAPH_WEBHOOK_URL;
    return value && /^https:\/\//.test(value) ? value : null;
  }
  private expiration(resource: string) {
    const hours = resource.includes("onlineMeetings") ? 69 : 24 * 6;
    return new Date(Date.now() + hours * 3600000).toISOString();
  }
  async ensureCalendar(source: Source) {
    const webhook = this.webhook();
    if (!webhook) return;
    const current = await this.db.one<Subscription>(
      `SELECT * FROM external_subscriptions
       WHERE provider_id=$1 AND source_id=$2 AND status='active'
       ORDER BY expires_at DESC LIMIT 1`,
      [this.providerId, source.id],
    );
    if (current && new Date(current.expires_at).getTime() > Date.now() + 24 * 3600000) return;
    if (current) {
      try {
        await this.renew(current);
        return;
      } catch {
        await this.db.query(
          "UPDATE external_subscriptions SET status='expired',updated_at=now() WHERE id=$1",
          [current.id],
        );
      }
    }
    const connection = await this.graph.connection(source.connection_id, source.owner_id);
    const secret = randomBytes(32).toString("base64url");
    const resource = `/me/calendars/${encodeURIComponent(source.external_id)}/events`;
    const created = await this.graph.request<{
      id: string;
      resource: string;
      expirationDateTime: string;
    }>(connection, "subscriptions", {
      method: "POST",
      body: JSON.stringify({
        changeType: "created,updated,deleted",
        notificationUrl: webhook,
        lifecycleNotificationUrl: webhook,
        resource,
        expirationDateTime: this.expiration(resource),
        clientState: secret,
        latestSupportedTlsVersion: "v1_2",
      }),
    });
    await this.db.query(
      `INSERT INTO external_subscriptions(owner_id,provider_id,connection_id,source_id,external_id,resource,change_types,secret_encrypted,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,'created,updated,deleted',$7,$8)
       ON CONFLICT(provider_id,external_id) DO UPDATE SET status='active',expires_at=excluded.expires_at,
       secret_encrypted=excluded.secret_encrypted,updated_at=now()`,
      [
        source.owner_id,
        this.providerId,
        source.connection_id,
        source.id,
        created.id,
        created.resource || resource,
        this.vault.seal({ secret }),
        new Date(created.expirationDateTime),
      ],
    );
  }
  async renew(subscription: Subscription) {
    const connection = await this.graph.connection(subscription.connection_id, subscription.owner_id);
    const result = await this.graph.request<{ expirationDateTime: string }>(
      connection,
      `subscriptions/${encodeURIComponent(subscription.external_id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ expirationDateTime: this.expiration(subscription.resource) }),
      },
    );
    await this.db.query(
      "UPDATE external_subscriptions SET status='active',expires_at=$2,updated_at=now() WHERE id=$1",
      [subscription.id, new Date(result.expirationDateTime)],
    );
  }
  async removeForSource(sourceId: string) {
    const subscriptions = await this.db.query<Subscription>(
      "SELECT * FROM external_subscriptions WHERE provider_id=$1 AND source_id=$2 AND status='active'",
      [this.providerId, sourceId],
    );
    for (const subscription of subscriptions) {
      const connection = await this.graph.connection(subscription.connection_id, subscription.owner_id);
      await this.graph
        .request<void>(connection, `subscriptions/${encodeURIComponent(subscription.external_id)}`, {
          method: "DELETE",
        })
        .catch(() => undefined);
    }
    await this.db.query(
      "UPDATE external_subscriptions SET status='stopped',updated_at=now() WHERE provider_id=$1 AND source_id=$2 AND status='active'",
      [this.providerId, sourceId],
    );
  }
  async renewDue() {
    const due = await this.db.query<Subscription>(
      `SELECT * FROM external_subscriptions WHERE provider_id=$1 AND status='active'
       AND expires_at<now()+interval '24 hours'`,
      [this.providerId],
    );
    for (const subscription of due)
      await this.renew(subscription).catch(() =>
        this.db.query(
          "UPDATE external_subscriptions SET status='error',updated_at=now() WHERE id=$1",
          [subscription.id],
        ),
      );
  }
  async accept(body: { value?: Notification[] }) {
    const sourceIds = new Set<string>();
    for (const notification of body.value || []) {
      if (!notification.subscriptionId || !notification.clientState) continue;
      const subscription = await this.db.one<Subscription & { tenant_id?: string }>(
        `SELECT s.*,c.metadata->>'tenantId' AS tenant_id
         FROM external_subscriptions s JOIN integration_connections c ON c.id=s.connection_id
         WHERE s.provider_id=$1 AND s.external_id=$2 AND s.status='active'`,
        [this.providerId, notification.subscriptionId],
      );
      if (!subscription || !subscription.source_id) continue;
      if (notification.tenantId && subscription.tenant_id && notification.tenantId !== subscription.tenant_id) continue;
      const expected = this.vault.open<{ secret: string }>(subscription.secret_encrypted).secret;
      const received = Buffer.from(notification.clientState);
      const wanted = Buffer.from(expected);
      if (received.length !== wanted.length || !timingSafeEqual(received, wanted)) continue;
      const fingerprint = createHash("sha256")
        .update(
          [
            notification.subscriptionId,
            notification.changeType,
            notification.resource,
            notification.resourceData?.id,
            notification.resourceData?.["@odata.etag"],
          ].join("|"),
        )
        .digest("hex");
      const receipt = await this.db.one(
        `INSERT INTO external_notification_receipts(provider_id,fingerprint,expires_at)
         VALUES($1,$2,now()+interval '1 day') ON CONFLICT DO NOTHING RETURNING fingerprint`,
        [this.providerId, fingerprint],
      );
      if (!receipt) continue;
      sourceIds.add(subscription.source_id);
      await this.db.query(
        "UPDATE external_subscriptions SET last_notification_at=now(),updated_at=now() WHERE id=$1",
        [subscription.id],
      );
    }
    await this.db.query("DELETE FROM external_notification_receipts WHERE expires_at<now()");
    return [...sourceIds];
  }
}
