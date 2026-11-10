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

const baseUrl = process.env.ORBIT_SELENIUM_BASE_URL || process.env.WEB_ORIGIN || 'http://localhost:3000';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const user = (await pool.query('SELECT id,name,email FROM users ORDER BY created_at LIMIT 1')).rows[0];
assert.ok(user, 'Selenium needs at least one Orbit user in the database.');
assert.ok(process.env.JWT_SECRET, 'JWT_SECRET is required to create a temporary browser session.');

const suffix = randomUUID().slice(0, 8);
let boardId;
let driver;

async function cardByTitle(title) {
  const cards = await driver.findElements(By.css('.kanban-card'));
  for (const card of cards) {
    if ((await card.getText()).includes(title)) return card;
  }
  throw new Error(`Card not found in the browser: ${title}`);
}

async function titleElement(card) {
  return card.findElement(By.xpath(".//div[contains(@class,'leading-5')]"));
}

try {
  const board = (await pool.query(
    "INSERT INTO boards(title,owner_id) VALUES($1,$2) RETURNING id",
    [`Selenium card click ${suffix}`, user.id],
  )).rows[0];
  boardId = board.id;
  await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')", [boardId, user.id]);
  const list = (await pool.query(
    "INSERT INTO lists(board_id,title,position) VALUES($1,'Selenium checks',0) RETURNING id",
    [boardId],
  )).rows[0];
  const singleTitle = `Single click ${suffix}`;
  const doubleTitle = `Double click ${suffix}`;
  await pool.query(
    'INSERT INTO cards(list_id,title,position) VALUES($1,$2,0),($1,$3,1)',
    [list.id, singleTitle, doubleTitle],
  );

  const token = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const options = new Options().addArguments('--headless=new', '--no-sandbox', '--disable-dev-shm-usage');
  driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
  await driver.manage().window().setRect({ width: 1365, height: 950 });
  await driver.get(baseUrl);
  await driver.executeScript(
    'localStorage.setItem("orbit_token", arguments[0]); localStorage.setItem("orbit_user", arguments[1]);',
    token,
    JSON.stringify(user),
  );
  await driver.get(`${baseUrl}/board/${boardId}`);

  const singleCard = await driver.wait(async () => {
    try { return await cardByTitle(singleTitle); } catch { return false; }
  }, 15000, 'Board did not render the single-click fixture card.');
  const singleTitleElement = await titleElement(singleCard);
  await driver.executeScript("window.__orbitClickProbe=[]; document.addEventListener('click', e => window.__orbitClickProbe.push({detail:e.detail, target:e.target?.outerHTML?.slice(0,160)}), true)");
  const clickedAt = Date.now();
  await singleTitleElement.click();
  let dialog;
  try {
    dialog = await driver.wait(
      until.elementLocated(By.css('[role="dialog"]')),
      1500,
      'A single click should open the card.',
      25,
    );
  } catch (error) {
    const diagnostics = await driver.executeScript(() => {
      const title = [...document.querySelectorAll('.kanban-card')].find(card => card.textContent?.includes('Single click'));
      const rect = title?.getBoundingClientRect();
      const target = rect && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { url: location.href, dialogCount: document.querySelectorAll('[role="dialog"]').length, card: title?.innerText, hitTarget: target?.outerHTML.slice(0, 300), clicks: window.__orbitClickProbe, reactProps: title && Object.keys(title).filter(key => key.startsWith('__reactProps')).map(key => Object.keys(title[key])) };
    });
    console.error('Selenium click diagnostics:', JSON.stringify(diagnostics));
    console.error('Browser console:', JSON.stringify((await driver.manage().logs().get('browser')).map(entry => ({ level: entry.level.name, message: entry.message }))));
    throw error;
  }
  const openDuration = Date.now() - clickedAt;
  console.log(`Single click opened the card after ${openDuration} ms.`);
  assert.ok(openDuration < 450, 'A single click must open the card without a 500 ms delay.');
  assert.equal(await dialog.isDisplayed(), true, 'A single click should open the card dialog.');
  assert.equal(await driver.findElements(By.css('.kanban-card input[aria-label="Título do cartão"]')).then(items => items.length), 0,
    'A single click must not start inline title editing.');
  console.log('PASS: single click opens the card immediately without starting inline title editing.');

  await dialog.findElement(By.css('button[aria-label="Fechar"]')).click();
  await driver.wait(until.stalenessOf(dialog), 5000, 'Card dialog did not close.');
  const doubleCard = await driver.wait(async () => {
    try { return await cardByTitle(doubleTitle); } catch { return false; }
  }, 5000, 'Double-click fixture card did not return after closing the dialog.');
  await driver.actions().doubleClick(await titleElement(doubleCard)).perform();
  const titleInput = await driver.wait(
    until.elementLocated(By.css('.kanban-card input[aria-label="Título do cartão"]')),
    1500,
    'A double click should start inline title editing.',
    25,
  );
  assert.equal(await titleInput.isDisplayed(), true, 'A double click should expose the inline title editor.');
  assert.equal(await titleInput.getAttribute('value'), doubleTitle, 'Inline editor should contain the card title.');
  assert.equal(await driver.findElements(By.css('[role="dialog"]')).then(items => items.length), 0,
    'A double click should edit the title without opening the card dialog.');
  console.log('PASS: double click starts inline title editing without opening the card dialog.');
} finally {
  if (driver) await driver.quit();
  if (boardId) await pool.query('DELETE FROM boards WHERE id=$1', [boardId]);
  await pool.end();
}
