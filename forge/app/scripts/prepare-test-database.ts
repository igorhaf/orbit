import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Db } from "../apps/api/src/db";
import { migrateVersions } from "../apps/api/src/migrations";

async function main() {
  const target = new URL(process.env.DATABASE_URL || "");
  if (
    !/^orbit_restore_tests_[a-f0-9]+$/.test(target.pathname.slice(1)) ||
    target.pathname.slice(1) !== process.env.ORBIT_TEST_ISOLATED_DATABASE
  )
    throw new Error("A preparação exige um banco descartável de testes.");
  const db = new Db();
  try {
    await db.query(
      await readFile(resolve(__dirname, "../apps/api/sql/schema.sql"), "utf8"),
    );
    await db.query(
      await readFile(
        resolve(__dirname, "../apps/api/sql/pre-022-compat.sql"),
        "utf8",
      ),
    );
    await migrateVersions(db.pool);
    console.log("Banco descartável preparado para a suíte de integração.");
  } finally {
    await db.pool.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
