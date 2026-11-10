import "dotenv/config";
import { Pool } from "pg";
import { protectRecordPayload } from "./data-protector";
import { learnerProfileSensitiveFields } from "./plugins/suinda/suinda.plugin";
const apply = process.argv.includes("--apply");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (!process.env.ORBIT_DATA_ENCRYPTION_KEY) throw new Error("ORBIT_DATA_ENCRYPTION_KEY is required.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let cursor: string | null = null;
  let records = 0;
  let changedRecords = 0;
  let changedVersions = 0;

  try {
    while (true) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const batch: { rows: Array<{ id: string; revision: number; payload: Record<string, unknown> }> } = await client.query<{ id: string; revision: number; payload: Record<string, unknown> }>(
          `SELECT id::text,revision,payload FROM extension_records
           WHERE plugin_id='suinda-learning' AND kind='learner_profile' AND ($1::uuid IS NULL OR id>$1::uuid)
           ORDER BY id LIMIT 50 FOR UPDATE`, [cursor],
        );
        if (!batch.rows.length) {
          await client.query("COMMIT");
          break;
        }

        for (const record of batch.rows) {
          records += 1;
          cursor = record.id;
          const context = { pluginId: "suinda-learning", kind: "learner_profile", recordId: record.id };
          const current = protectRecordPayload(record.payload, learnerProfileSensitiveFields, { ...context, revision: record.revision });
          if (JSON.stringify(current) !== JSON.stringify(record.payload)) {
            changedRecords += 1;
            if (apply) await client.query("UPDATE extension_records SET payload=$1::jsonb WHERE id=$2", [JSON.stringify(current), record.id]);
          }

          const versions = await client.query<{ revision: number; payload: Record<string, unknown> }>(
            "SELECT revision,payload FROM extension_record_versions WHERE record_id=$1 ORDER BY revision FOR UPDATE", [record.id],
          );
          for (const version of versions.rows) {
            const protectedPayload = protectRecordPayload(version.payload, learnerProfileSensitiveFields, { ...context, revision: version.revision });
            if (JSON.stringify(protectedPayload) === JSON.stringify(version.payload)) continue;
            changedVersions += 1;
            if (apply) await client.query(
              "UPDATE extension_record_versions SET payload=$1::jsonb WHERE record_id=$2 AND revision=$3",
              [JSON.stringify(protectedPayload), record.id, version.revision],
            );
          }
        }

        if (apply) await client.query("COMMIT");
        else await client.query("ROLLBACK");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", records_scanned: records,
    records_to_protect: changedRecords, historical_versions_to_protect: changedVersions }));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`Suindá protected-field backfill stopped: ${message}`);
  process.exitCode = 1;
});
