import { Inject, Injectable } from "@nestjs/common";
import { Db } from "../db";
import { PluginDefinition } from "./contract";

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
};

@Injectable()
export class PluginNotifications {
  constructor(@Inject(Db) private readonly db: Db) {}

  async publish(pluginId: string, userId: string, input: PluginNotificationInput) {
    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(pluginId)) throw new Error("ID de plugin inválido.");
    const kind = input.kind.trim();
    const title = input.title.trim();
    const targetUrl = input.targetUrl?.trim() || null;
    if (!kind || kind.length > 32 || !title || title.length > 300) throw new Error("Notificação inválida.");
    if (targetUrl && (!targetUrl.startsWith("/") || targetUrl.startsWith("//"))) throw new Error("Destino de notificação inválido.");
    const preferences = await this.db.one<{ enabled: boolean }>("SELECT COALESCE((preferences->>'notifications')::boolean,true) AS enabled FROM users WHERE id=$1", [userId]);
    if (!preferences?.enabled) return null;
    return this.db.one(
      `INSERT INTO notifications(plugin_id,user_id,board_id,card_id,kind,title,body,target_url)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,plugin_id,user_id,kind,title,body,target_url,created_at`,
      [pluginId,userId,input.boardId || null,input.cardId || null,kind,title,input.body?.slice(0,1000) || "",targetUrl],
    );
  }
}
