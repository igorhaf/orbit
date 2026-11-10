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
const databaseUrl = new URL(process.env.DATABASE_URL);
databaseUrl.hostname = process.env.ORBIT_SELENIUM_DB_HOST || '127.0.0.1';
const pool = new Pool({ connectionString: databaseUrl.toString() });
const baseUrl = process.env.ORBIT_SELENIUM_BASE_URL || 'http://127.0.0.1:3001';
const user = (await pool.query('SELECT id,name,email FROM users ORDER BY created_at LIMIT 1')).rows[0];
assert.ok(user && process.env.JWT_SECRET);

let boardId;
let driver;
try {
  const suffix = randomUUID().slice(0, 8);
  boardId = (await pool.query('INSERT INTO boards(title,owner_id) VALUES($1,$2) RETURNING id', [`Anexos colados ${suffix}`, user.id])).rows[0].id;
  await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')", [boardId, user.id]);
  const listId = (await pool.query("INSERT INTO lists(board_id,title,position) VALUES($1,'Validação',0) RETURNING id", [boardId])).rows[0].id;
  const card = (await pool.query('INSERT INTO cards(list_id,title,description,position) VALUES($1,$2,$3,0) RETURNING id', [listId, `Anexos ${suffix}`, 'Descrição inicial'])).rows[0];
  driver = await new Builder().forBrowser('chrome').setChromeOptions(new Options().addArguments('--headless=new', '--no-sandbox', '--disable-dev-shm-usage')).build();
  await driver.manage().window().setRect({ width: 1365, height: 950 });
  await driver.get(baseUrl);
  const token = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '10m' });
  await driver.executeScript('localStorage.setItem("orbit_token",arguments[0]);localStorage.setItem("orbit_user",arguments[1]);', token, JSON.stringify(user));
  await driver.get(`${baseUrl}/board/${boardId}`);
  const cardElement = await driver.wait(until.elementLocated(By.css('.kanban-card')), 20000);
  await cardElement.findElement(By.xpath(".//div[contains(@class,'leading-5')]")).click();
  const dialog = await driver.wait(until.elementLocated(By.css('[role="dialog"]')), 10000);

  await dialog.findElement(By.xpath(".//button[normalize-space()='Editar descrição']")).click();
  const editor = await driver.wait(until.elementLocated(By.css('[role="dialog"] .ProseMirror[contenteditable="true"]')), 15000);
  await editor.click();
  await driver.executeScript((element) => {
    const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=';
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files: [], items: [], getData: type => type === 'text/html' ? `<img src="data:image/png;base64,${image}">` : '' } });
    element.dispatchEvent(event);
  }, editor);
  await driver.wait(until.elementLocated(By.css('[aria-label="Anexos do cartão"]')), 15000, 'Imagem colada não apareceu como anexo do cartão.');
  assert.equal(await editor.findElements(By.css('img')).then(items => items.length), 0, 'Imagem anexada não deve entrar no corpo da descrição.');
  assert.match(await dialog.findElement(By.css('[aria-label="Anexos do cartão"]')).getText(), /imagem-colada-1\.png/);
  await dialog.findElement(By.xpath(".//button[normalize-space()='Salvar']")).click();
  await driver.wait(async () => (await pool.query('SELECT count(*)::int AS count FROM attachments WHERE card_id=$1 AND kind=\'file\' AND mime_type=\'image/png\'', [card.id])).rows[0].count === 1, 15000);
  assert.equal((await pool.query('SELECT description FROM cards WHERE id=$1', [card.id])).rows[0].description, 'Descrição inicial', 'A descrição deve permanecer sem o conteúdo binário/link da imagem.');
  const embeddedAttachmentCount = await pool.query("SELECT count(*)::int AS count FROM attachments WHERE card_id=$1 AND kind='file' AND mime_type='image/png'", [card.id]);
  assert.equal(embeddedAttachmentCount.rows[0].count, 1, 'A imagem colada deve ser enviada uma única vez como anexo.');

  const textarea = await dialog.findElement(By.css('textarea[placeholder^="Escreva um comentário"]'));
  await textarea.click();
  await driver.executeScript((element) => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII='), char => char.charCodeAt(0));
    const file = new File([bytes], '', { type: 'image/png' });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files: [], items: [{ kind: 'file', getAsFile: () => file }] } });
    element.dispatchEvent(event);
  }, textarea);
  await driver.wait(until.elementLocated(By.xpath("//*[@role='dialog']//span[contains(.,'arquivo-colado-1.png')]")), 10000, 'Imagem colada não foi adicionada aos anexos pendentes do comentário.');
  const form = await textarea.findElement(By.xpath('ancestor::form'));
  await form.findElement(By.xpath(".//button[normalize-space()='Salvar']")).click();
  await driver.wait(async () => {
    const result = await pool.query("SELECT count(*)::int AS count FROM comment_attachments a JOIN comments c ON c.id=a.comment_id WHERE c.card_id=$1 AND a.kind='file' AND a.mime_type='image/png' AND a.name='arquivo-colado-1.png'", [card.id]);
    return result.rows[0].count === 1;
  }, 15000, 'Imagem colada não foi salva como anexo do comentário.');
  console.log('PASS: imagem somente em HTML virou um único anexo fora da descrição; imagem exposta só em items e sem nome foi anexada no comentário.');
} finally {
  if (driver) await driver.quit();
  if (boardId) await pool.query('DELETE FROM boards WHERE id=$1', [boardId]);
  await pool.end();
}
