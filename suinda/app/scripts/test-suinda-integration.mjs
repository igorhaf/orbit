import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const apiUnit = "native-suinda-api.service";
const state = execFileSync("systemctl", ["--user", "show", apiUnit, "--property=ActiveState", "--value"], { encoding: "utf8" }).trim();
const apiPidOutput = execFileSync("ss", ["-lntp", "sport", "=", ":4004"], { encoding: "utf8" });
const apiPid = apiPidOutput.match(/pid=(\d+),/)?.[1];
if (state !== "active" || !apiPid || Number(apiPid) < 1) {
  throw new Error("A API nativa do Suindá precisa estar ativa para localizar o banco isolado desta instância.");
}

const apiCgroup = readFileSync(`/proc/${apiPid}/cgroup`, "utf8");
if (!apiCgroup.includes(apiUnit)) throw new Error("A porta 4004 não pertence à unidade nativa da API Suindá.");

const apiEnvironment = Object.fromEntries(readFileSync(`/proc/${apiPid}/environ`, "utf8").split("\0")
  .filter((entry) => entry.includes("="))
  .map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)]));
if (!apiEnvironment.DATABASE_URL) throw new Error("A API ativa não declara DATABASE_URL.");
const target = new URL(apiEnvironment.DATABASE_URL);
const databaseName = decodeURIComponent(target.pathname.slice(1));
if (target.hostname !== "127.0.0.1" || target.port !== "5432" || databaseName !== "suinda_native") {
  throw new Error("Integração Suindá requer o destino local isolado 127.0.0.1:5432/suinda_native da API ativa.");
}

const preflight = new pg.Pool({ connectionString: target.toString(), connectionTimeoutMillis: 4000 });
try {
  const { rows: [identity] } = await preflight.query(`
    SELECT current_database() AS database_name, current_user AS database_role,
      has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_test_schema,
      inet_server_port() AS server_port
  `);
  if (identity.database_name !== databaseName || Number(identity.server_port) !== 5432 || identity.can_create_test_schema !== true) {
    throw new Error("O usuário da API não pode criar schemas descartáveis no banco isolado do Suindá.");
  }
  console.log(`Banco PostgreSQL nativo isolado: 127.0.0.1:${identity.server_port}/${identity.database_name}; schemas de teste descartáveis.`);
} finally {
  await preflight.end();
}
if (process.argv.includes("--preflight")) process.exit(0);

const env = {
  ...process.env,
  DATABASE_URL: target.toString(),
  ORBIT_ENV: "development",
  ORBIT_TEST_DB_HOST: target.hostname,
  ORBIT_TEST_DB_ADMIN_URL: target.toString(),
  ORBIT_SECRET_KEY: randomBytes(32).toString("hex"),
  ORBIT_DATA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  VAULT_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  JWT_SECRET: randomBytes(32).toString("hex"),
};
delete env.ORBIT_SELENIUM_DB_HOST;
delete env.ORBIT_TEST_DB_CONTAINER;
delete env.ORBIT_SECRET_KEY_PREVIOUS;
delete env.ORBIT_DATA_ENCRYPTION_KEY_PREVIOUS;
delete env.VAULT_ENCRYPTION_KEY_PREVIOUS;

const child = spawn("npm", ["run", "test:integration", "-w", "apps/api"], { cwd: root, env, stdio: "inherit" });
child.on("error", (error) => {
  console.error(`Não foi possível iniciar a suíte de integração: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) console.error(`A suíte de integração terminou pelo sinal ${signal}.`);
  process.exitCode = code ?? 1;
});
