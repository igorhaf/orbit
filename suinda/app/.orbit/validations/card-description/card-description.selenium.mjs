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
  boardId = (await pool.query('INSERT INTO boards(title,owner_id) VALUES($1,$2) RETURNING id', [`Descrição visual ${suffix}`, user.id])).rows[0].id;
  await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')", [boardId, user.id]);
  const listId = (await pool.query("INSERT INTO lists(board_id,title,position) VALUES($1,'Validação',0) RETURNING id", [boardId])).rows[0].id;
  const card = (await pool.query('INSERT INTO cards(list_id,title,description,position) VALUES($1,$2,$3,0) RETURNING id', [listId, `Descrição ${suffix}`, '**Texto em negrito** e um link: [Orbit](https://example.com)'])).rows[0];
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
  const editable = await driver.wait(until.elementLocated(By.css('[role="dialog"] .ProseMirror[contenteditable="true"]')), 15000);
  assert.equal(await editable.findElements(By.css('strong')).then(items => items.length), 1, 'Markdown antigo deve abrir formatado.');
  assert.equal(await editable.findElements(By.css('a')).then(items => items.length), 1, 'Links devem abrir formatados.');
  assert.equal(await editable.findElements(By.css('textarea')).then(items => items.length), 0, 'Descrição não deve usar textarea.');
  await editable.click();
  await driver.executeScript(() => {
    const data = new DataTransfer();
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII='), char => char.charCodeAt(0));
    data.items.add(new File([bytes], 'imagem-teste.png', { type: 'image/png' }));
    document.querySelector('[role="dialog"] .ProseMirror').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await driver.wait(async () => (await editable.findElements(By.css('img')).then(items => items.length)) > 0, 20000, 'Imagem colada não apareceu dentro do editor.');
  await dialog.findElement(By.xpath(".//button[normalize-space()='Salvar']")).click();
  await driver.wait(async () => (await pool.query('SELECT description FROM cards WHERE id=$1', [card.id])).rows[0].description.includes('/api/card-attachments/'), 15000);
  const description = (await pool.query('SELECT description FROM cards WHERE id=$1', [card.id])).rows[0].description;
  assert.match(description, /!\[[^\]]*\]\(\/api\/card-attachments\/[^)]+\)/);
  assert.match(description, /\*\*Texto em negrito\*\*/);
  await driver.wait(async () => (await dialog.findElements(By.css('.rich-text img')).then(items => items.length)) > 0, 15000, 'Imagem não apareceu após salvar.');
  await driver.wait(until.elementLocated(By.xpath("//*[@role='dialog']//button[normalize-space()='Editar descrição']")), 15000).then(button => button.click());
  await driver.wait(async () => (await dialog.findElements(By.css('.ProseMirror img')).then(items => items.length)) > 0, 15000, 'Imagem salva não reapareceu na edição visual.');
  console.log('PASS: descrição formatada na edição; imagem incorporada ao colar, salva e renderizada no card.');
} finally {
  if (driver) await driver.quit();
  if (boardId) await pool.query('DELETE FROM boards WHERE id=$1', [boardId]);
  await pool.end();
}
