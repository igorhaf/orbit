import 'dotenv/config';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { Pool } from 'pg';
import { sanitizeNotebookHtml } from './notebook-sanitizer';

test('sanitized notebook HTML stays safe after a PostgreSQL write/read round-trip', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.hostname = process.env.ORBIT_TEST_DB_HOST || process.env.ORBIT_SELENIUM_DB_HOST || url.hostname;
  const adminUrl = new URL(url);
  adminUrl.username = execFileSync('docker', ['exec', 'orbit-db-dev', 'printenv', 'POSTGRES_USER'], { encoding: 'utf8' }).trim();
  adminUrl.password = execFileSync('docker', ['exec', 'orbit-db-dev', 'printenv', 'POSTGRES_PASSWORD'], { encoding: 'utf8' }).trim();
  const schema = `notebook_sanitize_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: adminUrl.toString() });
  const db = new Pool({ connectionString: url.toString(), options: `-c search_path=${schema}` });
  try {
    await admin.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${url.username}`);
    await db.query('CREATE TABLE users(id uuid PRIMARY KEY)');
    await db.query(await readFile(resolve(__dirname, '../sql/migrations/009_notebooks.sql'), 'utf8'));
    const owner = randomUUID();
    await db.query('INSERT INTO users(id) VALUES($1)', [owner]);
    const safe = sanitizeNotebookHtml('<svg/onload=run()><p style="color:#123456;text-align:center" onclick=run()>Título <strong>seguro</strong></p><a href="javascript:run()">link</a>');
    const inserted = await db.query('INSERT INTO notebooks(owner_id,title,content_html) VALUES($1,$2,$3) RETURNING id', [owner, 'Teste XSS', safe]);
    const saved = await db.query('SELECT content_html FROM notebooks WHERE id=$1', [inserted.rows[0].id]);
    assert.equal(saved.rows[0].content_html, '<p style="color:#123456;text-align:center">Título <strong>seguro</strong></p><a>link</a>');
    assert.doesNotMatch(saved.rows[0].content_html, /<svg|onload|onclick|javascript:/i);
  } finally {
    await db.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
