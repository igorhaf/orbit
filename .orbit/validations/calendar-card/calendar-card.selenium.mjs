import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { Builder, By, until } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/chrome.js';

const repoRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
dotenv.config({ path: resolve(repoRoot, 'apps/api/.env'), quiet: true });
assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required.');
assert.ok(process.env.JWT_SECRET, 'JWT_SECRET is required.');

const databaseUrl = new URL(process.env.DATABASE_URL);
if (process.env.ORBIT_SELENIUM_DB_HOST) databaseUrl.hostname = process.env.ORBIT_SELENIUM_DB_HOST;
const pool = new Pool({ connectionString: databaseUrl.toString() });
const baseUrl = process.env.ORBIT_SELENIUM_BASE_URL || process.env.WEB_ORIGIN || 'http://localhost:3001';
const suffix = randomUUID().slice(0, 8);
const title = `Calendar card ${suffix}`;
let boardId;
let driver;

try {
  const user = (await pool.query('SELECT id,name,email FROM users ORDER BY created_at LIMIT 1')).rows[0];
  assert.ok(user, 'An Orbit user is required.');
  boardId = (await pool.query('INSERT INTO boards(title,owner_id) VALUES($1,$2) RETURNING id', [`Calendar validation ${suffix}`, user.id])).rows[0].id;
  await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')", [boardId, user.id]);
  const listId = (await pool.query("INSERT INTO lists(board_id,title,position) VALUES($1,'Calendar validation',0) RETURNING id", [boardId])).rows[0].id;
  const start = new Date(Date.now() + 60 * 60_000);
  const end = new Date(start.getTime() + 60 * 60_000);
  const card = (await pool.query('INSERT INTO cards(list_id,title,position,schedule_start_at,schedule_end_at) VALUES($1,$2,0,$3,$4) RETURNING id,url_token', [listId, title, start, end])).rows[0];

  const token = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const options = new Options().addArguments('--headless=new', '--no-sandbox', '--disable-dev-shm-usage');
  driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
  await driver.manage().window().setRect({ width: 1365, height: 950 });
  await driver.get(baseUrl);
  await driver.executeScript('localStorage.setItem("orbit_token", arguments[0]); localStorage.setItem("orbit_user", arguments[1]);', token, JSON.stringify(user));
  await driver.get(`${baseUrl}/calendar`);

  const item = await driver.wait(until.elementLocated(By.xpath(`//button[@title='${title}']`)), 20000, 'The scheduled card did not appear in the calendar.');
  await driver.wait(until.elementIsVisible(item), 5000);
  await item.click();
  await driver.wait(async () => (await driver.getCurrentUrl()).includes(`/board/${boardId}?card=${card.id}`), 15000, 'The calendar did not navigate to the card.');
  const openedUrl = new URL(await driver.getCurrentUrl());
  assert.equal(openedUrl.searchParams.get('token'), card.url_token, 'The card URL token must be preserved.');
  const dialog = await driver.wait(until.elementLocated(By.css('[role="dialog"]')), 15000, 'The card dialog did not open.');
  const titleInput = await dialog.findElement(By.css('input[aria-label="Título do cartão"]'));
  assert.equal(await titleInput.getAttribute('value'), title, 'The opened dialog belongs to another card.');
  console.log('PASS: clicking a scheduled card in the calendar opens its card dialog.');
} finally {
  if (driver) await driver.quit();
  if (boardId) await pool.query('DELETE FROM boards WHERE id=$1', [boardId]);
  await pool.end();
}
