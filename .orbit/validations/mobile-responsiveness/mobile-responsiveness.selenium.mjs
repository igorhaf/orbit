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
assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required.');
assert.ok(process.env.JWT_SECRET, 'JWT_SECRET is required.');

const databaseUrl = new URL(process.env.DATABASE_URL);
databaseUrl.hostname = process.env.ORBIT_SELENIUM_DB_HOST || '127.0.0.1';
const pool = new Pool({ connectionString: databaseUrl.toString() });
const baseUrl = process.env.ORBIT_SELENIUM_BASE_URL || 'http://127.0.0.1:3001';
const user = (await pool.query('SELECT id,name,email FROM users ORDER BY created_at LIMIT 1')).rows[0];
assert.ok(user, 'Mobile Selenium requires an Orbit user.');

const suffix = randomUUID().slice(0, 8);
const boardTitle = `Mobile validation ${suffix}`;
const cardTitle = `Mobile card ${suffix}`;
let boardId;
let driver;

const viewports = [
  { name: 'small Android', width: 320, height: 740 },
  { name: 'iPhone SE class', width: 375, height: 812 },
  { name: 'large phone', width: 430, height: 932 },
  { name: 'tablet portrait', width: 768, height: 1024 },
];
const coreRoutes = [
  { path: '/inbox', name: 'Inbox' },
  { path: '/collections', name: 'Coleções' },
  { path: '/notebooks', name: 'Cadernos' },
  { path: '/vault', name: 'Cofre' },
  { path: '/profile', name: 'Perfil' },
  { path: '/backups', name: 'Backups' },
  { path: '/tools', name: 'Ferramentas' },
  { path: '/trash', name: 'Lixeira' },
];

async function tapElement(element) {
  const point = await driver.executeScript((target) => {
    const rect = target.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  }, element);
  await driver.sendAndGetDevToolsCommand('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
  });
  await driver.sendAndGetDevToolsCommand('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

async function useViewport(viewport) {
  await driver.sendAndGetDevToolsCommand('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 2,
    mobile: true,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  await driver.sendAndGetDevToolsCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await driver.get(`${baseUrl}/boards`);
  await driver.wait(until.elementLocated(By.css('main')), 15000, `${viewport.name}: boards did not render.`);
  await auditViewport(viewport, 'Quadros');
}

async function auditViewport(viewport, pageName) {
  const metrics = await driver.executeScript(() => {
    const main = document.querySelector('main') || document.querySelector('.board-scroll');
    const heading = main?.querySelector('h1');
    const rect = main?.getBoundingClientRect();
    return {
      title: document.title,
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      mainWidth: rect?.width ?? 0,
      mainLeft: rect?.left ?? 0,
      mainRight: rect?.right ?? 0,
      heading: heading?.innerText?.trim() ?? '',
      mainText: main?.innerText?.trim().slice(0, 180) ?? '',
      bodyText: document.body.innerText.trim().slice(0, 180),
    };
  });
  assert.ok(metrics.documentWidth <= viewport.width + 1, `${viewport.name} · ${pageName}: document overflows horizontally (${metrics.documentWidth}px > ${viewport.width}px).`);
  assert.ok(metrics.mainWidth > viewport.width * 0.72, `${viewport.name} · ${pageName}: main content is too narrow (${metrics.mainWidth}px).`);
  assert.ok(metrics.mainLeft >= -1 && metrics.mainRight <= viewport.width + 1, `${viewport.name} · ${pageName}: main content escapes the viewport.`);
  assert.ok(metrics.mainText.length > 0, `${viewport.name} · ${pageName}: main content is blank.`);
  console.log(`PASS ${viewport.name} · ${pageName}: ${metrics.mainWidth}px content, no horizontal page overflow.`);
  return metrics;
}

async function openMobileMenu(viewport) {
  const button = await driver.wait(until.elementLocated(By.css('button[aria-label="Abrir navegação"]')), 10000);
  const rect = await button.getRect();
  assert.ok(rect.width >= 44 && rect.height >= 44, `${viewport.name}: mobile menu touch target is ${rect.width}×${rect.height}px; expected at least 44×44px.`);
  await tapElement(button);
  const menu = await driver.wait(until.elementLocated(By.css('nav[aria-label="Navegação principal"]')), 5000);
  const menuBounds = await driver.executeScript((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
  }, menu);
  assert.ok(menuBounds.left >= 0 && menuBounds.right <= viewport.width + 1, `${viewport.name}: mobile navigation escapes the screen: ${JSON.stringify(menuBounds)}.`);
  assert.ok(menuBounds.top >= 0 && menuBounds.bottom <= viewport.height + 1, `${viewport.name}: mobile navigation escapes the visible height: ${JSON.stringify(menuBounds)}.`);
  return menu;
}

try {
  const board = (await pool.query('INSERT INTO boards(title,owner_id) VALUES($1,$2) RETURNING id', [boardTitle, user.id])).rows[0];
  boardId = board.id;
  await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')", [boardId, user.id]);
  const listId = (await pool.query("INSERT INTO lists(board_id,title,position) VALUES($1,'Mobile checks',0) RETURNING id", [boardId])).rows[0].id;
  await pool.query('INSERT INTO cards(list_id,title,description,position) VALUES($1,$2,$3,0)', [listId, cardTitle, 'Card para validar abertura e toque em tela pequena.']);

  const token = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const options = new Options().addArguments('--headless=new', '--no-sandbox', '--disable-dev-shm-usage');
  driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
  await driver.manage().window().setRect({ width: 430, height: 932 });
  await driver.get(baseUrl);
  await driver.executeScript('localStorage.setItem("orbit_token", arguments[0]); localStorage.setItem("orbit_user", arguments[1]);', token, JSON.stringify(user));

  for (const viewport of viewports) {
    await useViewport(viewport);

    const menu = await openMobileMenu(viewport);
    const calendarLink = await menu.findElement(By.xpath(".//button[.//span[normalize-space()='Calendário']]"));
    const calendarLinkRect = await calendarLink.getRect();
    assert.ok(calendarLinkRect.height >= 44, `${viewport.name}: calendar menu item is too short for touch (${calendarLinkRect.height}px).`);
    await tapElement(calendarLink);
    await driver.wait(until.urlContains('/calendar'), 12000, `${viewport.name}: tapping Calendar did not navigate.`);
    await driver.wait(until.elementLocated(By.css('main')), 10000);
    await auditViewport(viewport, 'Calendário');

    await driver.get(`${baseUrl}/board/${boardId}`);
    await driver.wait(until.elementLocated(By.css('.kanban-card')), 15000, `${viewport.name}: fixture card did not render.`);
    const boardMetrics = await auditViewport(viewport, 'Quadro');
    assert.ok(boardMetrics.mainWidth > viewport.width * 0.72, `${viewport.name}: board content is compressed by a persistent sidebar.`);

    const card = await driver.findElement(By.css('.kanban-card'));
    await tapElement(card);
    const dialog = await driver.wait(until.elementLocated(By.css('[role="dialog"]')), 10000, `${viewport.name}: touching card did not open it.`);
    const dialogMetrics = await driver.executeScript((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
    }, dialog);
    assert.ok(dialogMetrics.left >= 0 && dialogMetrics.right <= viewport.width + 1, `${viewport.name}: card dialog escapes viewport width: ${JSON.stringify(dialogMetrics)}.`);
    assert.ok(dialogMetrics.top >= 0 && dialogMetrics.bottom <= viewport.height + 1, `${viewport.name}: card dialog escapes viewport height: ${JSON.stringify(dialogMetrics)}.`);
    const closeButton = await dialog.findElement(By.css('button[aria-label="Fechar"]'));
    const closeRect = await closeButton.getRect();
    assert.ok(closeRect.width >= 40 && closeRect.height >= 40, `${viewport.name}: dialog close control is too small (${closeRect.width}×${closeRect.height}px).`);
    await tapElement(closeButton);
    await driver.wait(until.stalenessOf(dialog), 5000, `${viewport.name}: card dialog did not close after touch.`);
    console.log(`PASS ${viewport.name} · card dialog touch open/close and visible bounds.`);

    const addCardButton = await driver.findElement(By.xpath("//button[normalize-space()='Adicionar um cartão']"));
    const addCardBounds = await addCardButton.getRect();
    assert.ok(addCardBounds.height >= 44, `${viewport.name}: add-card touch target is only ${addCardBounds.height}px tall.`);
    await tapElement(addCardButton);
    const cardInput = await driver.wait(until.elementLocated(By.css('input[placeholder="Insira o título do cartão"]')), 5000);
    const createdCardTitle = `Touch-created ${viewport.width} ${suffix}`;
    await cardInput.sendKeys(createdCardTitle);
    const submitCardButton = await driver.findElement(By.xpath("//form[.//input[@placeholder='Insira o título do cartão']]//button[normalize-space()='Adicionar cartão']"));
    await tapElement(submitCardButton);
    await driver.wait(until.elementLocated(By.xpath(`//*[contains(@class,'kanban-card') and contains(.,'${createdCardTitle}')]`)), 10000, `${viewport.name}: touch-created card did not appear.`);
    console.log(`PASS ${viewport.name} · add-card action via touch.`);

    for (const route of coreRoutes) {
      await driver.get(`${baseUrl}${route.path}`);
      await driver.wait(async () => await driver.executeScript('return location.pathname') === route.path, 5000);
      await driver.wait(until.elementLocated(By.css('main')), 10000, `${viewport.name} · ${route.name}: main content did not render.`);
      await driver.wait(async () => (await driver.executeScript("return document.querySelector('main')?.innerText?.trim().length || 0")) > 0, 10000, `${viewport.name} · ${route.name}: main content stayed blank.`);
      await auditViewport(viewport, route.name);
    }
  }

  console.log('PASS responsive validation completed for 320px, 375px, 430px, and 768px viewports across core app routes.');
} finally {
  if (driver) await driver.quit();
  if (boardId) await pool.query('DELETE FROM boards WHERE id=$1', [boardId]);
  await pool.end();
}
