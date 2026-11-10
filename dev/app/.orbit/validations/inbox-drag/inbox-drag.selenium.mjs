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
      'The Inbox must be highlighted while the card is over it.');
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
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET is required for a temporary browser session.');
  user = (await pool.query('SELECT id,name,email FROM users ORDER BY created_at LIMIT 1')).rows[0];
  assert.ok(user, 'The configured Orbit account must exist.');
  const board = (await pool.query(
    'INSERT INTO boards(title,owner_id) VALUES($1,$2) RETURNING id',
    [`Selenium Inbox drag ${suffix}`, user.id],
  )).rows[0];
  boardId = board.id;
  await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')", [boardId, user.id]);
  const inboxList = (await pool.query(
    'SELECT l.id FROM lists l JOIN boards b ON b.id=l.board_id WHERE b.owner_id=$1 AND b.is_inbox AND l.archived_at IS NULL ORDER BY l.position LIMIT 1',
    [user.id],
  )).rows[0];
  assert.ok(inboxList, 'The configured account must have an Inbox.');
  const lists = [];
  for (let index = 0; index < 6; index++) {
    lists.push((await pool.query('INSERT INTO lists(board_id,title,position) VALUES($1,$2,$3) RETURNING id',
      [board.id, `List ${index}`, index])).rows[0]);
  }
  const cards = [];
  for (let index = 0; index < 8; index++) {
    cards.push((await pool.query('INSERT INTO cards(list_id,title,position) VALUES($1,$2,$3) RETURNING id,title',
      [index >= 6 ? lists[5].id : lists[0].id, `Inbox drag ${index} ${suffix}`, index])).rows[0]);
  }

  fixtureCardIds.push(...cards.map(card => card.id));

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
  await driver.get(`${baseUrl}/board/${board.id}`);
  await cardElement(cards[0].id);

  await drag(cards[0].id, `[data-orbit-list="${lists[1].id}"]`);
  await expectList(cards[0].id, lists[1].id);
  console.log('PASS: moving between board lists still works.');

  for (let index = 0; index < 5; index++) {
    const target = index === 0 ? '[data-orbit-inbox-drop]'
      : index === 1 ? '[data-orbit-inbox-drop] input'
      : index === 2 ? '[data-orbit-inbox-drop] button[draggable]'
      : index === 3 ? '[data-orbit-inbox-tab-drop]'
      : '[data-orbit-inbox-drop]';
    const highlight = index === 3 ? '[data-orbit-inbox-tab-drop]' : '[data-orbit-inbox-drop]';
    await drag(cards[index].id, target, highlight);
    await expectList(cards[index].id, inboxList.id);
    await driver.wait(async () => (await driver.findElement(By.css('[data-orbit-inbox-drop]')).getText()).includes(cards[index].title),
      10000, 'The Inbox did not show the moved card.');
    await driver.wait(async () => (await driver.findElements(By.css(`.kanban-card[data-card-id="${cards[index].id}"]`))).length === 0,
      10000, 'The board still shows the moved card.');
  }
  console.log('PASS: five consecutive drops over the panel, input, existing card and Inbox tab.');

  await driver.findElement(By.css('button[aria-label="Aba Coleções"]')).click();
  await drag(cards[5].id, '[data-orbit-inbox-tab-drop]', '[data-orbit-inbox-tab-drop]');
  await expectList(cards[5].id, inboxList.id);
  console.log('PASS: the Inbox tab accepts a drop while Collections is open.');
  await driver.findElement(By.css('button[aria-label="Aba Inbox"]')).click();

  await driver.executeScript('document.querySelector(".board-scroll").scrollLeft = 1500;');
  await cardElement(cards[6].id);
  await drag(cards[6].id, '[data-orbit-inbox-drop]', '[data-orbit-inbox-drop]');
  await expectList(cards[6].id, inboxList.id);
  console.log('PASS: Inbox drop after horizontal board scrolling.');

  await driver.executeScript('localStorage.setItem("orbit_sidebar_pinned", "false"); window.dispatchEvent(new Event("sidebar:changed"));');
  await drag(cards[7].id, '[data-orbit-inbox-tab-drop]', '[data-orbit-inbox-tab-drop]');
  await expectList(cards[7].id, inboxList.id);
  console.log('PASS: the Inbox tab accepts a drop with the sidebar collapsed.');
} catch (error) {
  if (driver) {
    console.error('Browser diagnostic:', await driver.executeScript(() => ({
      path: location.pathname,
      message: document.querySelector('[role="alert"]')?.textContent?.slice(0, 500),
      cards: document.querySelectorAll('.kanban-card').length,
    })));
  }
  throw error;
} finally {
  try {
    if (driver) await driver.quit();
  } finally {
    if (fixtureCardIds.length) await pool.query('DELETE FROM cards WHERE id=ANY($1::uuid[])', [fixtureCardIds]);
    if (boardId) await pool.query('DELETE FROM boards WHERE id=$1', [boardId]);
    await pool.end();
  }
}
