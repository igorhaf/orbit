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
const suffix = randomUUID().slice(0, 8);
let user;
let driver;
let boardId;
const fixtureCardIds = [];
const fixtureListIds = [];

async function cardElement(cardId) {
  return driver.wait(until.elementLocated(By.css(`.kanban-card[data-card-id="${cardId}"]`)), 10000);
}

async function drag(cardId, targetSelector, highlightedSelector) {
  const source = await cardElement(cardId);
  const target = await driver.findElement(By.css(targetSelector));
  await driver.actions()
    .move({ origin: source })
    .press()
    .move({ origin: 'pointer', x: 12, y: 8, duration: 150 })
    .pause(100)
    .move({ origin: target, duration: 700 })
    .pause(200)
    .perform();
  if (highlightedSelector) {
    assert.match(await driver.findElement(By.css(highlightedSelector)).getAttribute('class'), /ring-2/,
      'The collection must be highlighted while the card is over it.');
  }
  await driver.actions().release().perform();
}

async function expectList(cardId, listId) {
  await driver.wait(async () => {
    const row = (await pool.query('SELECT list_id FROM cards WHERE id=$1', [cardId])).rows[0];
    return row?.list_id === listId;
  }, 10000, 'The drop did not persist the expected destination.');
}

try {
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET is required.');
  user = (await pool.query('SELECT id,name,email FROM users ORDER BY created_at LIMIT 1')).rows[0];
  assert.ok(user, 'An Orbit account must exist.');
  const collection = (await pool.query('SELECT id FROM boards WHERE owner_id=$1 AND is_collection', [user.id])).rows[0];
  assert.ok(collection, 'The account must have Collections.');
  boardId = (await pool.query('INSERT INTO boards(title,owner_id) VALUES($1,$2) RETURNING id',
    [`Selenium collection drag ${suffix}`, user.id])).rows[0].id;
  await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')", [boardId, user.id]);
  const sourceLists = [];
  for (let index = 0; index < 6; index++) {
    sourceLists.push((await pool.query('INSERT INTO lists(board_id,title,position) VALUES($1,$2,$3) RETURNING id',
      [boardId, `Source ${index}`, index])).rows[0].id);
  }
  const categories = [];
  for (let index = 0; index < 3; index++) {
    const list = (await pool.query('INSERT INTO lists(board_id,title,position,parent_list_id) VALUES($1,$2,$3,$4) RETURNING id',
      [collection.id, `Drag category ${suffix}`, -100 + index, index === 2 ? categories[0] : null])).rows[0];
    categories.push(list.id);
    fixtureListIds.push(list.id);
  }
  const cards = [];
  for (let index = 0; index < 7; index++) {
    const card = (await pool.query('INSERT INTO cards(list_id,title,position) VALUES($1,$2,$3) RETURNING id,title',
      [index === 6 ? sourceLists[5] : sourceLists[0], `Collection drag ${index} ${suffix}`, index])).rows[0];
    cards.push(card);
    fixtureCardIds.push(card.id);
  }
  const token = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '10m' });
  driver = await new Builder().forBrowser('chrome').setChromeOptions(
    new Options().addArguments('--headless=new', '--no-sandbox', '--disable-dev-shm-usage'),
  ).build();
  await driver.manage().window().setRect({ width: 1365, height: 950 });
  await driver.get(baseUrl);
  await driver.executeScript(
    'localStorage.setItem("orbit_token", arguments[0]); localStorage.setItem("orbit_user", arguments[1]); localStorage.setItem("orbit_sidebar_pinned", "true");',
    token, JSON.stringify(user),
  );
  await driver.get(`${baseUrl}/board/${boardId}`);
  await cardElement(cards[0].id);
  await driver.findElement(By.css('button[aria-label="Aba Coleções"]')).click();
  const category = index => `[data-orbit-collection-drop="${categories[index]}"]`;
  await driver.wait(until.elementLocated(By.css(category(0))), 10000);
  await drag(cards[0].id, `${category(0)} button[aria-expanded]`, category(0));
  await expectList(cards[0].id, categories[0]);
  await driver.wait(async () => !(await driver.findElements(By.css(`.kanban-card[data-card-id="${cards[0].id}"]`))).length, 10000);
  await driver.findElement(By.css(`${category(0)} button[aria-expanded]`)).click();
  await driver.wait(async () => (await driver.findElement(By.css(category(0))).getText()).includes(cards[0].title), 10000);
  console.log('PASS: closed collection accepts the drop and both panels refresh.');
  await drag(cards[1].id, `${category(0)} button[aria-expanded]`, category(0));
  await expectList(cards[1].id, categories[0]);
  await driver.wait(async () => (await driver.findElement(By.css(category(0))).getText()).includes(cards[1].title), 10000);
  await drag(cards[2].id, `${category(0)} .border-l button`, category(0));
  await expectList(cards[2].id, categories[0]);
  console.log('PASS: open collection accepts repeated drops and drops over an existing item.');
  await drag(cards[3].id, `${category(2)} button[aria-expanded]`, category(2));
  await expectList(cards[3].id, categories[2]);
  console.log('PASS: subcategory receives the item without moving it to its parent.');
  await driver.findElement(By.xpath('//button[text()="Selecionar"]')).click();
  await (await cardElement(cards[4].id)).click();
  await (await cardElement(cards[5].id)).click();
  await driver.wait(async () => (await driver.findElement(By.css('body')).getText()).includes('2/20 selecionados'), 5000);
  await drag(cards[4].id, `${category(1)} button[aria-expanded]`, category(1));
  await expectList(cards[4].id, categories[1]);
  await expectList(cards[5].id, categories[1]);
  console.log('PASS: selected cards move together to the correct category even with duplicate names.');
  await driver.executeScript('document.querySelector(".board-scroll").scrollLeft = 1500;');
  await drag(cards[6].id, `${category(1)} button[aria-expanded]`, category(1));
  await expectList(cards[6].id, categories[1]);
  console.log('PASS: collection drop works after horizontal scrolling.');
} finally {
  try {
    if (driver) await driver.quit();
  } finally {
    if (fixtureCardIds.length) await pool.query('DELETE FROM cards WHERE id=ANY($1::uuid[])', [fixtureCardIds]);
    if (fixtureListIds.length) await pool.query('DELETE FROM lists WHERE id=ANY($1::uuid[])', [fixtureListIds]);
    if (boardId) await pool.query('DELETE FROM boards WHERE id=$1', [boardId]);
    await pool.end();
  }
}
