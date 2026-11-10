import type { Db } from "../db";

/** Persist only a coarse device label; never retain the raw User-Agent or IP address. */
export function loginDeviceLabel(userAgent?: string): string {
  const agent = (userAgent || "").slice(0, 2000);
  const browser = /Edg\//.test(agent) ? "Edge" : /OPR\//.test(agent) ? "Opera"
    : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome"
      : /Safari\//.test(agent) ? "Safari" : "Navegador desconhecido";
  const platform = /iPhone|iPad|iPod/.test(agent) ? "iOS" : /Android/.test(agent) ? "Android"
    : /Windows NT/.test(agent) ? "Windows" : /Mac OS X/.test(agent) ? "macOS"
      : /Linux/.test(agent) ? "Linux" : "dispositivo desconhecido";
  return `${browser} · ${platform}`.slice(0, 160);
}

export async function recordSuccessfulLogin(db: Pick<Db, "query">, userId: string, userAgent?: string) {
  await db.query("INSERT INTO auth_login_history(user_id,device_label) VALUES($1,$2)", [userId, loginDeviceLabel(userAgent)]);
  await db.query("DELETE FROM auth_login_history WHERE user_id=$1 AND (logged_at<now()-interval '180 days' OR id IN (SELECT id FROM auth_login_history WHERE user_id=$1 ORDER BY logged_at DESC,id DESC OFFSET 1000))", [userId]);
}
