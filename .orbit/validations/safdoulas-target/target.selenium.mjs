import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import {Pool} from 'pg';
import {Builder,By,until} from 'selenium-webdriver';
import {Options} from 'selenium-webdriver/chrome.js';
dotenv.config({path:'apps/api/.env',quiet:true});const url=new URL(process.env.DATABASE_URL);url.hostname=process.env.ORBIT_SELENIUM_DB_HOST||url.hostname;const pool=new Pool({connectionString:url.toString()});const root=(await pool.query('SELECT id,name,email,is_root,session_version FROM users WHERE is_root ORDER BY created_at LIMIT 1')).rows[0];const token=jwt.sign({sub:root.id,email:root.email,version:root.session_version},process.env.JWT_SECRET,{expiresIn:'20m'});
const boardId='cf8aa888-6625-44fd-a54d-cd0e1f64dab8',projectId='77651047-0c09-4574-b054-26e8d3d83d00';
const response=await fetch('http://127.0.0.1:4001/boards/'+boardId,{headers:{Authorization:'Bearer '+token}});assert.equal(response.status,200);const board=await response.json();const cards=board.lists.flatMap(list=>list.cards);assert.equal(board.ai_default_project_id,projectId);assert.ok(cards.every(card=>(card.ai_project_id||board.ai_default_project_id)===projectId));
let driver;try{
 driver=await new Builder().forBrowser('chrome').setChromeOptions(new Options().addArguments('--headless=new','--no-sandbox','--disable-dev-shm-usage')).build();await driver.get('http://127.0.0.1:3001');await driver.executeScript('localStorage.setItem("orbit_token",arguments[0]);localStorage.setItem("orbit_user",arguments[1])',token,JSON.stringify(root));
 for(const [prefix,width] of [['D01',1440],['SAFDOULA — Escopo',375]]){
  const card=cards.find(card=>card.title.startsWith(prefix));assert.ok(card);await driver.sendAndGetDevToolsCommand('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<1000});await driver.get(`http://127.0.0.1:3001/board/${boardId}?card=${card.id}&token=${card.url_token}`);const dialog=await driver.wait(until.elementLocated(By.css('[role="dialog"]')),25000);await driver.wait(until.elementLocated(By.css('button[aria-label="Expandir IA do cartão"]')),15000);const button=await driver.findElement(By.css('button[aria-label="Expandir IA do cartão"]'));await driver.executeScript(e=>e.scrollIntoView({block:'center'}),button);await button.click();const select=await driver.wait(until.elementLocated(By.xpath("//label[starts-with(normalize-space(),'Projeto')]/select")),10000);await driver.wait(async()=>await select.getAttribute('value')===projectId,15000);assert.match(await dialog.getText(),/Diretriz vigente — desenvolvimento compartilhado em Orbit DEV/);assert.match(await dialog.getText(),/branch develop/);console.log(`PASS ${width}px ${card.title}: inherited Orbit DEV project and shared-development direction.`);
 }
 console.log(`PASS ${cards.length} effective project bindings; no card executed.`);
}finally{if(driver)await driver.quit();await pool.end()}
