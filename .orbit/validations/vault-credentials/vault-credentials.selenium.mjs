import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import {Pool} from 'pg';
import {Builder,By,until} from 'selenium-webdriver';
import {Options} from 'selenium-webdriver/chrome.js';
dotenv.config({path:'apps/api/.env',quiet:true});
const url=new URL(process.env.DATABASE_URL);url.hostname=process.env.ORBIT_SELENIUM_DB_HOST||'127.0.0.1';
const pool=new Pool({connectionString:url.toString()});let driver;const ids=[];
const base=process.env.ORBIT_SELENIUM_BASE_URL||'http://127.0.0.1:3001',apiBase=process.env.ORBIT_SELENIUM_API_URL||'http://127.0.0.1:4001';
try{
 const user=(await pool.query('SELECT id,name,email FROM users ORDER BY created_at LIMIT 1')).rows[0];
 const token=jwt.sign({sub:user.id,email:user.email},process.env.JWT_SECRET,{expiresIn:'15m'});
 const request=async(path,method='GET',body)=>{const response=await fetch(apiBase+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.ok(response.ok,`${path}: ${await response.clone().text()}`);return response.json()};
 driver=await new Builder().forBrowser('chrome').setChromeOptions(new Options().addArguments('--headless=new','--no-sandbox','--disable-dev-shm-usage')).build();
 await driver.sendAndGetDevToolsCommand('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('orbit_token',${JSON.stringify(token)});localStorage.setItem('orbit_user',${JSON.stringify(JSON.stringify(user))});`});
 for(const width of [320,390,1440]){
  await driver.sendAndGetDevToolsCommand('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
  await driver.sendAndGetDevToolsCommand('Emulation.setTouchEmulationEnabled',{enabled:width<500,maxTouchPoints:1});
  const item=await request('/vault','POST',{title:`Validação cofre ${randomUUID().slice(0,8)}`,category:'api',content_html:'<p>Anotações originais</p>'});ids.push(item.id);
  await driver.get(base+'/vault');
  await driver.wait(until.elementLocated(By.xpath(`//button[.//span[text()='${item.title}']]`)),20000);
  await driver.findElement(By.xpath(`//button[.//span[text()='${item.title}']]`)).click();
  await driver.wait(until.elementLocated(By.css('section[aria-label="Credenciais do caderno"]')),10000);
  const add=await driver.findElement(By.xpath("//button[contains(.,'Adicionar campo')]"));await driver.executeScript('arguments[0].scrollIntoView({block:"center"})',add);
  if(width<500){const rect=await driver.executeScript('const r=arguments[0].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}',add);await driver.sendAndGetDevToolsCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...rect,id:1}]});await driver.sendAndGetDevToolsCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}else await add.click();
  await driver.wait(until.elementLocated(By.css('input[aria-label="Nome do campo 1"]')),5000);
  await driver.findElement(By.css('input[aria-label="Nome do campo 1"]')).sendKeys('Token de teste');
  await driver.findElement(By.css('input[aria-label="Constante do campo 1"]')).sendKeys(`TEST_TOKEN_${width}`);
  await driver.findElement(By.css('input[aria-label="Valor do campo 1"]')).sendKeys('private-browser-value');
  await add.click();await driver.findElement(By.css('input[aria-label="Nome do campo 2"]')).sendKeys('Senha pessoal');await driver.findElement(By.css('input[aria-label="Valor do campo 2"]')).sendKeys('private-personal-value');
  await driver.wait(async()=>{const saved=await request(`/vault/${item.id}`);return saved.credentials.length===2&&saved.credentials[0].value==='private-browser-value'&&saved.credentials[1].value==='private-personal-value'},10000);
  await driver.navigate().refresh();await driver.wait(until.elementLocated(By.css('input[aria-label="Valor do campo 1"]')),20000);
  assert.equal(await driver.findElement(By.css('input[aria-label="Valor do campo 1"]')).getAttribute('type'),'password');
  assert.equal(await driver.findElement(By.css('.notebook-editor')).getText(),'Anotações originais');
  assert.equal(await driver.executeScript('return document.documentElement.scrollWidth>innerWidth'),false,`${width}px overflow`);
  const constants=await request('/vault/constants');assert(constants.some(field=>field.constant===`TEST_TOKEN_${width}`));assert(!JSON.stringify(constants).includes('private-browser-value'));assert(!constants.some(field=>field.name==='Senha pessoal'));
  await driver.get(base+'/profile?tab=integrations');await driver.wait(until.elementLocated(By.css('select[aria-label="Constante para Google OAuth Client Secret"]')),15000);
  await driver.wait(async()=> (await driver.findElement(By.css('select[aria-label="Constante para Google OAuth Client Secret"]')).getText()).includes(`TEST_TOKEN_${width}`),10000);
  const options=await driver.findElement(By.css('select[aria-label="Constante para Google OAuth Client Secret"]')).getText();assert(options.includes(`Tokens e APIs · TEST_TOKEN_${width}`));assert(!options.includes('Senha pessoal'));assert.equal(await driver.executeScript('return document.documentElement.scrollWidth>innerWidth'),false);
  console.log(`PASS ${width}px: campos, toque, autosave, recarga, notas, valores mascarados e seleção por categoria/constante`);
 }
}finally{if(driver)await driver.quit();for(const id of ids)await pool.query('DELETE FROM vault_items WHERE id=$1',[id]);await pool.end()}
