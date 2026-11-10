import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { Builder, By, until } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/chrome.js';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
dotenv.config({ path: resolve(root, 'apps/api/.env'), quiet: true });
assert.ok(process.env.DATABASE_URL && process.env.JWT_SECRET);
const databaseUrl = new URL(process.env.DATABASE_URL);
databaseUrl.hostname = process.env.ORBIT_SELENIUM_DB_HOST || '127.0.0.1';
const pool = new Pool({ connectionString: databaseUrl.toString() });
const baseUrl = process.env.ORBIT_SELENIUM_BASE_URL || 'http://127.0.0.1:3001';
let boardId;
let driver;
try {
  const project = (await pool.query(`SELECT p.id,p.owner_id,r.name AS repository_name FROM ai_projects p
    JOIN git_repositories r ON r.id=p.default_git_repository_id WHERE p.is_native=true LIMIT 1`)).rows[0];
  assert.ok(project, 'Projeto nativo sem repositório padrão.');
  const user = (await pool.query('SELECT id,name,email FROM users WHERE id=$1', [project.owner_id])).rows[0];
  assert.ok(user);
  const suffix = randomUUID().slice(0, 8);
  boardId = (await pool.query('INSERT INTO boards(title,owner_id,ai_default_project_id) VALUES($1,$2,$3) RETURNING id', [`Git validation ${suffix}`, user.id, project.id])).rows[0].id;
  await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')", [boardId, user.id]);
  const listId = (await pool.query("INSERT INTO lists(board_id,title,position) VALUES($1,'Validação Git',0) RETURNING id", [boardId])).rows[0].id;
  const title = `Git card ${suffix}`;
  const card = (await pool.query('INSERT INTO cards(list_id,title,position,completed) VALUES($1,$2,0,false) RETURNING id', [listId, title])).rows[0];
  driver = await new Builder().forBrowser('chrome').setChromeOptions(new Options().addArguments('--headless=new', '--no-sandbox', '--disable-dev-shm-usage')).build();
  await driver.manage().window().setRect({ width: 1365, height: 950 });
  await driver.get(baseUrl);
  const token = jwt.sign({ sub:user.id, email:user.email }, process.env.JWT_SECRET, { expiresIn:'10m' });
  await driver.executeScript('localStorage.setItem("orbit_token",arguments[0]);localStorage.setItem("orbit_user",arguments[1]);', token, JSON.stringify(user));
  await driver.get(`${baseUrl}/board/${boardId}?card=${card.id}`);
  const dialog = await driver.wait(until.elementLocated(By.css('[role="dialog"]')), 20000);
  const section = await dialog.findElement(By.css('section[aria-label="Git e deploy"]'));
  const toggle = await section.findElement(By.css('button[aria-expanded]'));
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'Git deve iniciar recolhido.');
  await toggle.click();
  await driver.wait(async () => (await toggle.getAttribute('aria-expanded')) === 'true', 5000);
  await driver.wait(until.elementLocated(By.xpath(`//*[@role='dialog']//p[contains(.,'Repositório padrão:') and contains(.,'${project.repository_name}')]`)), 15000);
  assert.equal((await section.findElements(By.css('select[aria-label="Repositório"]'))).length, 0, 'O card não deve exigir escolha do repositório.');
  let activity = await driver.wait(until.elementLocated(By.css('section[aria-label="Commits da atividade"]')), 15000);
  assert.ok(await activity.findElement(By.xpath('ancestor::section[.//h3[contains(.,"Atividade")]]')), 'Commits devem ficar dentro de Atividade.');
  await driver.wait(async () => (await activity.findElements(By.css('ul li'))).length > 0, 15000, 'Os commits globais não apareceram.');
  const globalToggle = await activity.findElement(By.css('button[aria-label="Commits globais"]'));
  assert.equal(await globalToggle.getAttribute('aria-expanded'), 'false', 'A lista global deve iniciar recolhida abaixo da lista do cartão.');
  assert.ok((await activity.findElements(By.css('ul li'))).length <= 10, 'A atividade deve mostrar no máximo cinco commits por lista.');
  assert.equal((await activity.findElements(By.xpath('.//button[contains(.,"Vincular")]'))).length, 0, 'Não deve haver vínculo manual de commit.');
  assert.equal((await activity.findElements(By.xpath('.//div[.//strong[normalize-space()="Próximo commit"]]'))).length, 0, 'Sem retorno do prompt, o formulário de commit não deve aparecer.');
  await pool.query(`INSERT INTO card_ai_runs(card_id,project_id,user_id,model,prompt,status,summary,file_changes,suggested_commit_type,suggested_commit_name,suggested_commit_summary,finished_at)
    VALUES($1,$2,$3,'gpt-6-luna','Validação Git','success','Corrige lista de commits do cartão.', $4::jsonb,'security-review',null,'Centraliza a apresentação dos commits.',now())`,
    [card.id, project.id, user.id, JSON.stringify([{ path:'apps/web/components/git-card-panel.tsx', kind:'update' }])]);
  const workflow = await driver.wait(until.elementLocated(By.xpath('.//div[.//strong[normalize-space()="Próximo commit"]]')), 15000, 'O formulário deve aparecer quando o retorno do prompt trouxer tipo, descrição e alterações.');
  let cardList = await activity.findElement(By.xpath('.//strong[normalize-space()="Deste cartão"]'));
  let typeField = await activity.findElement(By.css('select[aria-label="Tipo do próximo commit"]'));
  let messageField = await activity.findElement(By.css('input[aria-label="Descrição do commit"]'));
  assert.ok((await typeField.getRect()).y < (await cardList.getRect()).y, 'Tipo e descrição do commit devem ficar acima das listas.');
  assert.ok((await messageField.getRect()).y < (await cardList.getRect()).y, 'Descrição do commit deve ficar acima das listas.');
  assert.match(await workflow.getText(), /Conclua o cartão para habilitar/);
  for (const label of ['1 · Add', '2 · Commit', '3 · Push']) {
    assert.equal(await workflow.findElement(By.xpath(`.//button[normalize-space()="${label}"]`)).isEnabled(), false, `${label} só habilita após concluir o cartão.`);
  }
  await pool.query('UPDATE cards SET completed=true WHERE id=$1', [card.id]);
  await driver.navigate().refresh();
  activity = await driver.wait(until.elementLocated(By.css('section[aria-label="Commits da atividade"]')), 15000);
  const readyWorkflow = await driver.wait(until.elementLocated(By.xpath('.//div[.//strong[normalize-space()="Próximo commit"]]')), 15000);
  await driver.wait(async () => !(await readyWorkflow.getText()).includes('Repositório e branch: carregando'), 15000, 'A lista de arquivos não terminou de carregar.');
  assert.equal(await readyWorkflow.findElement(By.xpath('.//button[normalize-space()="1 · Add"]')).isEnabled(), true);
  assert.equal(await readyWorkflow.findElement(By.xpath('.//button[normalize-space()="2 · Commit"]')).isEnabled(), false);
  assert.equal(await readyWorkflow.findElement(By.xpath('.//button[normalize-space()="3 · Push"]')).isEnabled(), false);
  activity = await driver.findElement(By.css('section[aria-label="Commits da atividade"]'));
  cardList = await activity.findElement(By.xpath('.//strong[normalize-space()="Deste cartão"]'));
  typeField = await activity.findElement(By.css('select[aria-label="Tipo do próximo commit"]'));
  messageField = await activity.findElement(By.css('input[aria-label="Descrição do commit"]'));
  if (process.env.ORBIT_GIT_VALIDATE_HISTORY === '1') {
    await (await activity.findElements(By.xpath('.//button[normalize-space()="Ver todos"]')))[1].click();
    const history = await driver.wait(async () => (await driver.findElements(By.css('[role="dialog"]'))).at(-1), 5000);
    const row = await driver.wait(async () => (await history.findElements(By.css('article')))[0], 15000, 'Os commits não apareceram no modal.');
    await row.findElement(By.xpath('.//button[normalize-space()="Ver diff"]')).click();
    await driver.wait(async () => (await row.findElements(By.css('pre'))).length > 0, 15000, 'O diff não apareceu.');
    assert.match(await row.findElement(By.css('pre')).getText(), /diff --git/);
    await history.findElement(By.css('button[aria-label="Fechar"]')).click();
    await driver.wait(async () => (await messageField.getAttribute('value')) === 'Centraliza a apresentação dos commits.', 15000, 'A descrição do commit não veio do retorno do prompt.');
    await messageField.clear();
    await messageField.sendKeys('Centraliza commits do cartão');
    assert.equal(await messageField.getAttribute('value'), 'Centraliza commits do cartão');
    assert.equal(await typeField.getAttribute('value'), 'security-review', 'O tipo Conventional personalizado deve vir da IA e permanecer selecionado.');
    assert.equal((await activity.findElements(By.css('textarea[aria-label="Descrição do commit"]'))).length, 0, 'Não deve haver um campo separado para corpo do commit.');
    const bulk = await readyWorkflow.findElement(By.xpath('.//button[normalize-space()="Limpar seleção"]'));
    await bulk.click();
    await driver.wait(async () => (await readyWorkflow.getText()).includes('0 arquivo(s) selecionado(s)'), 5000, 'A seleção em massa não limpou os arquivos.');
    await readyWorkflow.findElement(By.xpath('.//button[normalize-space()="Selecionar todos"]')).click();
    await driver.wait(async () => (await readyWorkflow.getText()).includes('Limpar seleção'), 5000, 'A seleção em massa não selecionou todos os arquivos.');
    const filesToggle = await readyWorkflow.findElement(By.css('button[aria-label="Arquivos para Add"]'));
    assert.equal(await filesToggle.getAttribute('aria-expanded'), 'false', 'A lista de arquivos para Add deve iniciar recolhida.');
    await filesToggle.click();
    await driver.wait(async () => (await filesToggle.getAttribute('aria-expanded')) === 'true', 5000);
    const selected = await activity.findElements(By.css('input[type="checkbox"]:checked'));
    assert.ok(selected.length > 0, 'Arquivo alterado pelo cartão deve vir marcado.');
    const diffButton = await activity.findElement(By.xpath('.//button[normalize-space()="Diff"]'));
    await diffButton.click();
    const review = await driver.wait(async () => (await driver.findElements(By.css('[role="dialog"]'))).at(-1), 5000);
    await driver.wait(async () => (await review.findElements(By.css('pre'))).length >= 2, 15000, 'O diff lado a lado não apareceu.');
    await review.findElement(By.css('button[aria-label="Fechar"]')).click();
    assert.equal(await activity.findElement(By.xpath('.//button[normalize-space()="2 · Commit"]')).isEnabled(), false);
    assert.equal(await activity.findElement(By.xpath('.//button[normalize-space()="3 · Push"]')).isEnabled(), false);
  }
  console.log(process.env.ORBIT_GIT_VALIDATE_HISTORY === '1'
    ? 'PASS: commits em Atividade, sugestão automática, Add/Commit/Push e diff lado a lado.'
    : 'PASS: commits em Atividade e repositório padrão sem vínculo manual.');
} finally {
  if (driver) await driver.quit();
  if (boardId) await pool.query('DELETE FROM boards WHERE id=$1', [boardId]);
  await pool.end();
}
