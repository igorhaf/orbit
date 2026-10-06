import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { Builder, By, Key } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/chrome.js';
import { Select } from 'selenium-webdriver/lib/select.js';

const repoRoot=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
dotenv.config({path:resolve(repoRoot,'apps/api/.env'),quiet:true});
const baseUrl=(process.env.ORBIT_SELENIUM_BASE_URL||process.env.WEB_ORIGIN||'http://localhost:3001').replace(/\/$/,'');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const suffix=randomUUID().slice(0,8);
const title=`Selenium texto cofre ${suffix}`;
const bodyText=`Conteúdo do cofre ${suffix}`;
let boardId,cardId,vaultId,driver;

async function waitFor(callback,message,timeout=15000){return driver.wait(async()=>{try{return await callback()}catch{return false}},timeout,message,50)}
async function button(label,scope=driver){return waitFor(async()=>{const elements=await scope.findElements(By.xpath(`.//button[normalize-space(.)="${label}"]`));for(const element of elements)if(await element.isDisplayed())return element;return false},`Button ${label} did not appear`)}
async function vaultRow(){return (await pool.query('SELECT id,card_id,title,category,secret_data FROM vault_items WHERE id=$1',[vaultId])).rows[0]}
async function dialog(heading){return waitFor(()=>driver.findElement(By.xpath(`//div[@role="dialog"][.//h2[normalize-space(.)="${heading}"]]`)),`Dialog ${heading} did not appear`)}

try{
  assert.ok(process.env.DATABASE_URL,'DATABASE_URL is required');assert.ok(process.env.JWT_SECRET,'JWT_SECRET is required');
  const user=(await pool.query('SELECT id,name,email FROM users ORDER BY created_at LIMIT 1')).rows[0];assert.ok(user,'Orbit account required');
  boardId=(await pool.query('INSERT INTO boards(title,owner_id) VALUES($1,$2) RETURNING id',[`Selenium vault copy ${suffix}`,user.id])).rows[0].id;
  await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')",[boardId,user.id]);
  const listId=(await pool.query("INSERT INTO lists(board_id,title,position) VALUES($1,'Selenium vault list',0) RETURNING id",[boardId])).rows[0].id;
  const token=jwt.sign({sub:user.id,email:user.email},process.env.JWT_SECRET,{expiresIn:'10m'});
  driver=await new Builder().forBrowser('chrome').setChromeOptions(new Options().addArguments('--headless=new','--no-sandbox','--disable-dev-shm-usage')).build();
  await driver.manage().window().setRect({width:1440,height:1000});await driver.get(baseUrl);
  await driver.executeScript('localStorage.setItem("orbit_token",arguments[0]);localStorage.setItem("orbit_user",arguments[1]);',token,JSON.stringify(user));
  await driver.get(`${baseUrl}/vault`);
  const create=await button('Novo texto');await create.click();
  vaultId=await waitFor(async()=>{
    const row=(await pool.query("SELECT id FROM vault_items WHERE owner_id=$1 AND title='Novo texto' ORDER BY created_at DESC LIMIT 1",[user.id])).rows[0];
    return row?.id||false;
  },'New vault text did not persist');
  const titleInput=await waitFor(()=>driver.findElement(By.css('input[aria-label="Título do texto"]')),'Title input did not appear');
  await titleInput.sendKeys(Key.chord(Key.CONTROL,'a'),title);
  const editor=await driver.findElement(By.css('[contenteditable="true"]'));
  await editor.sendKeys(bodyText);
  await driver.executeScript('arguments[0].innerHTML += "<p><strong>Trecho em negrito</strong></p>"; arguments[0].dispatchEvent(new Event("input",{bubbles:true}));',editor);
  await waitFor(async()=>{const rows=(await pool.query('SELECT id FROM vault_items WHERE owner_id=$1 AND title=$2 ORDER BY created_at DESC LIMIT 1',[user.id,title])).rows;if(rows[0]){vaultId=rows[0].id;return true}return false},'Vault text did not save');
  const stored=await waitFor(async()=>{const row=await vaultRow();return row?.secret_data&&row.secret_data.includes('.')?row:false},'Vault text was not encrypted');
  assert.equal(stored.card_id,null,'Vault text must have no backing card');
  assert.equal(stored.category,'custom');
  assert.ok(!stored.secret_data.includes(bodyText),'Vault plaintext must not be stored in secret_data');
  await driver.navigate().refresh();
  const reloaded=await waitFor(()=>driver.findElement(By.css('[contenteditable="true"]')),'Saved text did not reload');
  await waitFor(async()=>((await reloaded.getText())||'').includes(bodyText),'Saved content did not reload');
  assert.equal(await driver.findElements(By.xpath('//button[normalize-space(.)="Mover para o cofre"]')).then(rows=>rows.length),0);
  console.log('PASS: category text is encrypted, reloads and has no backing card.');
  await (await button('Copiar como card')).click();
  const copyDialog=await dialog('Copiar texto como card');
  const selects=await copyDialog.findElements(By.css('select'));assert.equal(selects.length,2);
  await new Select(selects[0]).selectByValue(boardId);
  await waitFor(async()=>((await selects[1].findElements(By.css(`option[value="${listId}"]`))).length>0),'Destination list did not load');
  await new Select(selects[1]).selectByValue(listId);
  await (await button('Criar card',copyDialog)).click();
  const card=await waitFor(async()=>{const row=(await pool.query('SELECT id,title,description,kind FROM cards WHERE list_id=$1 AND title=$2 ORDER BY created_at DESC LIMIT 1',[listId,title])).rows[0];return row?.description?.includes(bodyText)?row:false},'Copied card was not created');
  cardId=card.id;assert.equal(card.kind,'normal');assert.ok(card.description.includes(bodyText));
  assert.match(card.description,/\*\*Trecho em negrito\*\*/,'Rich text must become Markdown');
  assert.ok(await vaultRow(),'Original vault text disappeared after copying');
  await driver.get(`${baseUrl}/vault`);
  await waitFor(async()=>((await driver.findElement(By.css('[contenteditable="true"]')).getText())||'').includes(bodyText),'Original text did not remain in the vault');
  console.log('PASS: card receives Markdown content and original text remains in the vault.');
}catch(error){if(driver){try{console.error('Selenium diagnostics:',JSON.stringify(await driver.executeScript(()=>({url:location.href,alerts:[...document.querySelectorAll('[role="alert"]')].map(node=>node.textContent?.slice(0,300))}))))}catch{}}throw error}
finally{try{if(driver)await driver.quit()}finally{if(vaultId)await pool.query('DELETE FROM vault_items WHERE id=$1',[vaultId]);if(cardId)await pool.query('DELETE FROM cards WHERE id=$1',[cardId]);if(boardId)await pool.query('DELETE FROM boards WHERE id=$1',[boardId]);await pool.end()}}
