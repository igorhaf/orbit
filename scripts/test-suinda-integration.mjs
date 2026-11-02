import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const envFile = resolve(root, ".env.local");
const localConfig = dotenv.parse(readFileSync(envFile));
if (!localConfig.SUINDA_DATABASE_URL) {
  throw new Error("Configure SUINDA_DATABASE_URL in the Suindá .env.local file.");
}

const target = new URL(localConfig.SUINDA_DATABASE_URL);
const databaseName = decodeURIComponent(target.pathname.slice(1));
if (!new Set(["127.0.0.1", "localhost"]).has(target.hostname)
  || target.port !== "5434" || databaseName !== "suinda_dev") {
  throw new Error("Integração Suindá requer o banco local suinda_dev em 127.0.0.1:5434.");
}

const container = "suinda-db";
const state = execFileSync("docker", ["inspect", "--format", "{{.State.Status}}", container], { encoding: "utf8" }).trim();
if (state !== "running") throw new Error("O container PostgreSQL suinda-db não está em execução.");
const containerUser = execFileSync("docker", ["exec", container, "printenv", "POSTGRES_USER"], { encoding: "utf8" }).trim();
const containerPassword = execFileSync("docker", ["exec", container, "printenv", "POSTGRES_PASSWORD"], { encoding: "utf8" }).trim();
if (decodeURIComponent(target.username) !== containerUser || decodeURIComponent(target.password) !== containerPassword) {
  throw new Error("A URL Suindá não corresponde às credenciais do container suinda-db.");
}

console.log(`Banco de integração isolado: ${target.hostname}:${target.port}/${databaseName} (${container}).`);
if (process.argv.includes("--preflight")) process.exit(0);

const env = {
  ...process.env,
  DATABASE_URL: target.toString(),
  ORBIT_ENV: "development",
  ORBIT_TEST_DB_HOST: "127.0.0.1",
  ORBIT_SELENIUM_DB_HOST: "127.0.0.1",
  ORBIT_TEST_DB_CONTAINER: container,
  ORBIT_SECRET_KEY: randomBytes(32).toString("hex"),
  ORBIT_DATA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  VAULT_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  JWT_SECRET: randomBytes(32).toString("hex"),
};
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
