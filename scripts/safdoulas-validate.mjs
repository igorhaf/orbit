import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sources = process.argv[2] || process.env.SAFDOULAS_SOURCES_DIR;
if (!sources) throw new Error("Informe a pasta dos treze documentos: node scripts/safdoulas-validate.mjs /pasta/dos/documentos");
const env = { ...process.env, SAFDOULAS_SOURCES_DIR: sources };
if (!env.DATABASE_URL) {
  try { env.DATABASE_URL = execFileSync("docker", ["exec", "orbit-dev", "printenv", "DATABASE_URL"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { throw new Error("Disponibilize o PostgreSQL DEV existente ou configure DATABASE_URL para o banco de testes; este comando não inicia serviços."); }
}
const result = spawnSync(process.execPath, ["scripts/with-dev-database.mjs", "--isolated", "npx", "tsx", "--tsconfig", "apps/api/tsconfig.json", "--test", "--test-concurrency=1",
  "apps/api/src/plugins/records/records.integration.spec.ts", "apps/api/src/safdoulas/journey.integration.spec.ts"], { cwd: root, env, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
