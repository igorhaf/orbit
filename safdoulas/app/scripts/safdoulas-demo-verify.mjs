import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import pg from 'pg';
import jwt from 'jsonwebtoken';

const reportDir = resolve(process.argv[2] || '../data/reports');
const base = 'http://127.0.0.1:4003';
const credentials = JSON.parse(await readFile(join(reportDir, 'safdoulas-demo-credentials.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(reportDir, 'safdoulas-demo-manifest.json'), 'utf8'));
const results = [];
async function request(label, path, expected, token, body) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  results.push({ label, status: response.status, expected });
  assert.equal(response.status, expected, `${label}: ${text.slice(0,300)}`);
  return text ? JSON.parse(text) : null;
}
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/safdoulas');
  const { rows: [root] } = await db.query('SELECT id,email,session_version FROM users WHERE is_root AND NOT disabled LIMIT 1');
  const rootToken = jwt.sign({ sub: root.id, version: root.session_version }, process.env.JWT_SECRET, { expiresIn: '5m' });
  await request('API saudável', '/health', 200);
  await request('Catálogo privado exige autenticação', '/extensions', 401);
  await request('Root consulta catálogo', '/extensions', 200, rootToken);
  await request('Root consulta regras publicadas', `/extensions/safdoulas-governance/records/${manifest.rule_id}`, 200, rootToken);
  const sessions = {};
  for (const [key, account] of Object.entries(credentials)) {
    const login = await request(`Login de ${key}`, '/auth/login', 201, null, { email: account.email, password: account.password });
    assert.ok(login.token, `Sessão ausente para ${key}`);
    sessions[key] = login.token;
    const me = await request(`Perfil de ${key}`, '/auth/me', 200, login.token);
    assert.equal(me.is_root, false, `${key} não deve ser root`);
    await request(`Catálogo de ${key}`, '/extensions', 200, login.token);
    if (key !== 'publico') await request(`Workspace de ${key}`, '/workspaces', 200, login.token);
  }
  for (const key of ['governanca', 'gt', 'diretoria', 'instituicao', 'representante']) {
    const list = await request(`Três processos para ${key}`, `/safdoulas/casework/workspaces/${manifest.workspace_id}`, 200, sessions[key]);
    assert.equal(list.processes.length, 3, `${key}: lista incompleta`);
    for (const item of manifest.processes) await request(`Dossiê permitido para ${key}`, `/safdoulas/casework/processes/${item.id}`, 200, sessions[key]);
  }
  const observer = await request('Observador só vê um processo compartilhado', `/safdoulas/casework/workspaces/${manifest.workspace_id}`, 200, sessions.observador);
  assert.equal(observer.processes.length, 1);
  await request('Observador não vê o rascunho privado', `/extensions/safdoulas-processes/records/${manifest.processes[0].id}`, 403, sessions.observador);
  await request('Público sem workspace interno', '/workspaces', 403, sessions.publico);
  await request('Público não vê processo', `/extensions/safdoulas-processes/records/${manifest.processes[2].id}`, 403, sessions.publico);
  await request('Acreditadora sem acesso ao original', `/extensions/documents/records/${manifest.original_document_id}`, 403, sessions.acreditadora);
  await request('Acreditadora sem acesso ao parecer alheio', `/extensions/safdoulas-assessments/records/${manifest.second_evaluation_id}`, 403, sessions.acreditadora);
  await request('Instituição não administra usuários', '/access/users', 403, sessions.instituicao);
  await request('Administrador consulta usuários', '/access/users', 200, sessions.admin);
  for (const path of ['/', '/safdoulas/processes', '/extensions/safdoulas-governance']) {
    const response = await fetch('http://127.0.0.1:3002' + path, { signal: AbortSignal.timeout(60000) });
    results.push({ label: `Página ${path}`, status: response.status, expected: 200 }); assert.equal(response.status,200);
  }
  await writeFile(join(reportDir, 'validacao-demo.json'), JSON.stringify({ date: '2026-10-21', passed: results.length, results, browser_validation: 'Não executada por restrição do host.' }, null, 2), { mode: 0o600 });
  console.log(`${results.length} verificações HTTP passaram, incluindo 11 logins, perfis e negativas de acesso.`);
} finally { await db.end(); }
