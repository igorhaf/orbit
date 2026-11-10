import dotenv from "dotenv";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
dotenv.config({ path: resolve(root, "apps/api/.env"), quiet: true });
if (!process.env.DATABASE_URL)
  throw new Error("Configure o banco DEV em apps/api/.env.");
const target = new URL(process.env.DATABASE_URL);
const address = execFileSync(
  "docker",
  [
    "inspect",
    "-f",
    "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
    "orbit-db-dev",
  ],
  { encoding: "utf8" },
).trim();
if (!address) throw new Error("PostgreSQL DEV indisponível.");
target.hostname = address;
process.env.DATABASE_URL = target.toString();
process.env.ORBIT_TEST_DB_HOST = address;
process.env.ORBIT_ENV = "development";
const argumentsList = process.argv.slice(2);
const isolated = argumentsList[0] === "--isolated";
if (isolated) argumentsList.shift();
const [command, ...args] = argumentsList;
if (!command) throw new Error("Informe o comando de validação.");
const databaseName = "orbit_restore_tests_" + randomUUID().replaceAll("-", "");
let admin;
let created = false;
try {
  if (isolated) {
    const adminTarget = new URL(target);
    adminTarget.username = execFileSync(
      "docker",
      ["exec", "orbit-db-dev", "printenv", "POSTGRES_USER"],
      { encoding: "utf8" },
    ).trim();
    adminTarget.password = execFileSync(
      "docker",
      ["exec", "orbit-db-dev", "printenv", "POSTGRES_PASSWORD"],
      { encoding: "utf8" },
    ).trim();
    adminTarget.pathname = "/postgres";
    admin = new pg.Pool({ connectionString: adminTarget.toString() });
    const owner =
      '"' + decodeURIComponent(target.username).replaceAll('"', '""') + '"';
    await admin.query(`CREATE DATABASE "${databaseName}" OWNER ${owner}`);
    created = true;
    target.pathname = "/" + databaseName;
    process.env.DATABASE_URL = target.toString();
    process.env.ORBIT_TEST_ISOLATED_DATABASE = databaseName;
    execFileSync(
      "npx",
      [
        "tsx",
        "--tsconfig",
        "apps/api/tsconfig.json",
        "scripts/prepare-test-database.ts",
      ],
      { cwd: root, env: process.env, stdio: "inherit" },
    );
  }
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (created) {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1",
      [databaseName],
    );
    await admin.query(`DROP DATABASE "${databaseName}"`);
  }
  if (admin) await admin.end();
}
