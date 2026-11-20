import assert from "node:assert/strict";
import test from "node:test";
import { loginDeviceLabel, recordSuccessfulLogin } from "./login-history";

test("login history stores only a coarse browser and platform label", () => {
  assert.equal(loginDeviceLabel("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"), "Edge · Windows");
  assert.equal(loginDeviceLabel("Mozilla/5.0 (Linux; Android 14) Firefox/130.0"), "Firefox · Android");
  assert.equal(loginDeviceLabel(undefined), "Navegador desconhecido · dispositivo desconhecido");
});

test("successful login records the device and trims history to 180 days and 1000 rows", async () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const db = { async query(sql: string, args: unknown[] = []) { calls.push({ sql, args }); return []; } };
  await recordSuccessfulLogin(db as never, "user-1", "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0");
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /INSERT INTO auth_login_history\(user_id,device_label\)/);
  assert.deepEqual(calls[0].args, ["user-1", "Chrome · Linux"]);
  assert.doesNotMatch(JSON.stringify(calls), /Mozilla|130\.0/);
  assert.match(calls[1].sql, /logged_at<now\(\)-interval '180 days'/);
  assert.match(calls[1].sql, /OFFSET 1000/);
});
