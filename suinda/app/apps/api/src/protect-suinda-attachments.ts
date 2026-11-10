import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { protectedAttachmentPrefix, sealProtectedAttachment } from "./data-protector";
import { suindaRecordKinds } from "./plugins/suinda/suinda.plugin";

const apply = process.argv.includes("--apply");
const marker = protectedAttachmentPrefix();
const sensitiveKinds = Object.entries(suindaRecordKinds)
  .filter(([, definition]) => definition.sensitiveAttachments === true)
  .map(([kind]) => kind);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (!process.env.ORBIT_DATA_ENCRYPTION_KEY) throw new Error("ORBIT_DATA_ENCRYPTION_KEY is required.");
  if (!sensitiveKinds.length) throw new Error("No Suindá record kind declares sensitive attachments.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const operationId = randomUUID();
  let scanned = 0;
  let protectedCount = 0;
  let filesScanned = 0;
  let filesProtected = 0;

  try {
    if (!apply) {
      const rows = await pool.query<{ kind: string; pending: string; protected: string }>(
        `SELECT r.kind,COUNT(*) FILTER (WHERE substring(a.data FROM 1 FOR $2)<>$3)::text AS pending,
           COUNT(*) FILTER (WHERE substring(a.data FROM 1 FOR $2)=$3)::text AS protected
         FROM extension_record_attachments a JOIN extension_records r ON r.id=a.record_id
         WHERE r.plugin_id='suinda-learning' AND r.kind=ANY($1::text[])
         GROUP BY r.kind ORDER BY r.kind`, [sensitiveKinds, marker.length, marker],
      );
      const totals = rows.rows.reduce((result, row) => {
        const pending = Number(row.pending), protectedRows = Number(row.protected);
        result.pending += pending; result.protected += protectedRows;
        result.by_kind[row.kind] = { pending, protected: protectedRows };
        return result;
      }, { pending: 0, protected: 0, by_kind: {} as Record<string, { pending: number; protected: number }> });
      const files = await pool.query<{ pending: string; protected: string }>(
        `SELECT COUNT(*) FILTER (WHERE substring(f.data FROM 1 FOR $1)<>$2)::text AS pending,
           COUNT(*) FILTER (WHERE substring(f.data FROM 1 FOR $1)=$2)::text AS protected
         FROM extension_files f JOIN extension_records r ON r.id=f.record_id
         WHERE r.plugin_id='documents' AND r.kind='document'`, [marker.length, marker],
      );
      console.log(JSON.stringify({ mode: "dry-run", ...totals,
        generic_documents: { pending: Number(files.rows[0]?.pending || 0), protected: Number(files.rows[0]?.protected || 0) } }));
      return;
    }

    while (true) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const batch = await client.query<{
          record_id: string; revision: number; attachment_id: string; kind: string;
          file_name: string; mime_type: string; sha256: string; data: Buffer;
        }>(
          `SELECT a.record_id::text,a.revision,a.id::text AS attachment_id,r.kind,a.file_name,a.mime_type,a.sha256,a.data
           FROM extension_record_attachments a JOIN extension_records r ON r.id=a.record_id
           WHERE r.plugin_id='suinda-learning' AND r.kind=ANY($1::text[])
             AND substring(a.data FROM 1 FOR $2)<>$3
           ORDER BY a.record_id,a.revision,a.id LIMIT 20 FOR UPDATE OF a`, [sensitiveKinds, marker.length, marker],
        );
        if (!batch.rows.length) {
          await client.query("COMMIT");
          break;
        }
        scanned += batch.rows.length;
        await client.query("SELECT set_config('orbit.attachment_encryption_operation_id',$1,true)", [operationId]);
        for (const row of batch.rows) {
          if (createHash("sha256").update(row.data).digest("hex") !== row.sha256)
            throw new Error(`Attachment integrity check failed for record ${row.record_id}, revision ${row.revision}.`);
          const encrypted = sealProtectedAttachment(row.data, {
            pluginId: "suinda-learning", kind: row.kind, recordId: row.record_id, revision: row.revision,
            attachmentId: row.attachment_id, fileName: row.file_name, mimeType: row.mime_type, sha256: row.sha256,
          });
          await client.query(
            `INSERT INTO orbit_attachment_encryption_targets(operation_id,record_id,revision,attachment_id)
             VALUES($1,$2,$3,$4)`, [operationId, row.record_id, row.revision, row.attachment_id],
          );
          const updated = await client.query(
            `UPDATE extension_record_attachments SET data=$1
             WHERE record_id=$2 AND revision=$3 AND id=$4 AND data=$5`,
            [encrypted, row.record_id, row.revision, row.attachment_id, row.data],
          );
          if (updated.rowCount !== 1) throw new Error(`Attachment changed during backfill for record ${row.record_id}, revision ${row.revision}.`);
          protectedCount += 1;
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    }

    while (true) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const batch = await client.query<{
          record_id: string; revision: number; file_name: string; mime_type: string; sha256: string; data: Buffer;
        }>(
          `SELECT f.record_id::text,f.revision,v.payload->>'file_name' AS file_name,
             v.payload->>'mime_type' AS mime_type,f.sha256,f.data
           FROM extension_files f JOIN extension_records r ON r.id=f.record_id
           JOIN extension_record_versions v ON v.record_id=f.record_id
             AND v.payload->>'file_revision'=f.revision::text
           WHERE r.plugin_id='documents' AND r.kind='document'
             AND substring(f.data FROM 1 FOR $1)<>$2
           ORDER BY f.record_id,f.revision LIMIT 20 FOR UPDATE OF f`, [marker.length, marker],
        );
        if (!batch.rows.length) { await client.query("COMMIT"); break; }
        filesScanned += batch.rows.length;
        await client.query("SELECT set_config('orbit.attachment_encryption_operation_id',$1,true)", [operationId]);
        for (const row of batch.rows) {
          if (!row.file_name || !row.mime_type || createHash("sha256").update(row.data).digest("hex") !== row.sha256)
            throw new Error(`Generic document integrity check failed for record ${row.record_id}, revision ${row.revision}.`);
          const encrypted = sealProtectedAttachment(row.data, {
            pluginId: "documents", kind: "document", recordId: row.record_id, revision: row.revision,
            attachmentId: "extension_file", fileName: row.file_name, mimeType: row.mime_type, sha256: row.sha256,
          });
          await client.query(
            `INSERT INTO orbit_extension_file_encryption_targets(operation_id,record_id,revision)
             VALUES($1,$2,$3)`, [operationId, row.record_id, row.revision],
          );
          const updated = await client.query(
            `UPDATE extension_files SET data=$1
             WHERE record_id=$2 AND revision=$3 AND data=$4`, [encrypted, row.record_id, row.revision, row.data],
          );
          if (updated.rowCount !== 1) throw new Error(`Generic document changed during backfill for record ${row.record_id}, revision ${row.revision}.`);
          filesProtected += 1;
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    }
  } finally { await pool.end(); }

  console.log(JSON.stringify({ mode: "apply", operation_id: operationId, attachments_scanned: scanned,
    attachments_protected: protectedCount, generic_documents_scanned: filesScanned, generic_documents_protected: filesProtected }));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`Suindá attachment backfill stopped: ${message}`);
  process.exitCode = 1;
});
