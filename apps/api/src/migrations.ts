import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';

export async function migrateVersions(pool:Pool) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(72641025)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    const directory=resolve(__dirname,'../sql/migrations');
    for(const version of (await readdir(directory)).filter(x=>/^\d+_[\w-]+\.sql$/.test(x)).sort()){
      const sql=await readFile(resolve(directory,version),'utf8');
      const checksum=createHash('sha256').update(sql).digest('hex');
      const existing=(await client.query('SELECT checksum FROM schema_migrations WHERE version=$1',[version])).rows[0];
      if(existing){if(existing.checksum!==checksum)throw new Error(`Migration changed after application: ${version}`);continue;}
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[version,checksum]);
    }
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
