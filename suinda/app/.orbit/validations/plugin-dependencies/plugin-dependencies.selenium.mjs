import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import {Pool} from 'pg';
import {Builder,By,until} from 'selenium-webdriver';
import {Options} from 'selenium-webdriver/chrome.js';
dotenv.config({path:'apps/api/.env',quiet:true});
const url=new URL(process.env.DATABASE_URL);url.hostname=process.env.ORBIT_SELENIUM_DB_HOST||url.hostname;const pool=new Pool({connectionString:url.toString()});
const root=(await pool.query('SELECT id,name,email,is_root,session_version FROM users WHERE is_root ORDER BY created_at LIMIT 1')).rows[0];
const token=jwt.sign({sub:root.id,email:root.email,version:root.session_version},process.env.JWT_SECRET,{expiresIn:'20m'});
const base=process.env.ORBIT_SELENIUM_BASE_URL||'http://127.0.0.1:3001';let first,second;const originals={};let checks=0;
async function call(path,method='GET',body){const response=await fetch('http://127.0.0.1:4001'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result}
async function create(width){const driver=await new Builder().forBrowser('chrome').setChromeOptions(new Options().addArguments('--headless=new','--no-sandbox','--disable-dev-shm-usage')).build();await driver.manage().window().setRect({width:1440,height:1000});await driver.sendAndGetDevToolsCommand('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<1000});await driver.sendAndGetDevToolsCommand('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await driver.get(base);await driver.executeScript('localStorage.setItem("orbit_token",arguments[0]);localStorage.setItem("orbit_user",arguments[1])',token,JSON.stringify(root));await driver.get(base+'/plugins');await driver.wait(until.elementLocated(By.css('[data-plugin-id="software-development"]')),20000);await driver.executeScript('window.__dependencyEvents=0;window.addEventListener("plugins:changed",()=>window.__dependencyEvents++)');return driver}
async function state(driver,id,status){await driver.wait(async()=>{const elements=await driver.findElements(By.css(`[data-plugin-id="${id}"]`));return elements.length>0&&await elements[0].getAttribute('data-plugin-status')===status},4500,`${id} did not become ${status} via live event`);checks++}
async function tap(driver,element){await driver.executeScript(e=>e.scrollIntoView({block:'center'}),element);const point=await driver.executeScript(e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}},element);await driver.sendAndGetDevToolsCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1,radiusX:2,radiusY:2,force:1}]});await driver.sendAndGetDevToolsCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
try{
 const catalog=(await call('/plugins')).plugins;for(const id of ['ai','software-development'])originals[id]=catalog.find(plugin=>plugin.id===id).configuredEnabled;
 await call('/plugins/ai','PATCH',{enabled:true});await call('/plugins/software-development','PATCH',{enabled:true});
 first=await create(1440);second=await create(375);await state(second,'software-development','active');
 const ai=await first.findElement(By.css('[data-plugin-id="ai"]'));assert.match(await ai.getText(),/Ao desativar, ficam indisponíveis:.*Desenvolvimento de software/s);checks++;
 await (await ai.findElement(By.xpath(".//button[normalize-space()='Desativar']"))).click();await state(first,'ai','disabled');await state(second,'software-development','blocked');
 const dependent=await second.findElement(By.css('[data-plugin-id="software-development"]'));assert.match(await dependent.getText(),/Aguardando dependência/);assert.match(await dependent.getText(),/Suspenso por: Inteligência artificial/);assert.ok(await second.executeScript('return window.__dependencyEvents>0'));checks++;
 // Explicitly disable the child while its base is unavailable, from the phone by touch.
 await tap(second,await dependent.findElement(By.xpath(".//button[normalize-space()='Desativar']")));await state(first,'software-development','disabled');await state(second,'software-development','disabled');
 await call('/plugins/ai','PATCH',{enabled:true});await state(second,'ai','active');await state(first,'software-development','disabled');
 await call('/plugins/software-development','PATCH',{enabled:true});await state(first,'software-development','active');await state(second,'software-development','active');
 for(const width of [320,375,768,1440]){
  await second.sendAndGetDevToolsCommand('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<1000});
  const metrics=await second.executeScript(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,heights:[...document.querySelectorAll('main article button')].filter(e=>e.getBoundingClientRect().height).map(e=>e.getBoundingClientRect().height)}));assert.ok(metrics.scroll<=metrics.width+1,`overflow ${width}`);for(const height of metrics.heights)assert.ok(height>=44,`small button ${height}`);checks++;
 }
 await second.navigate().refresh();await second.wait(until.elementLocated(By.css('[data-plugin-id="software-development"]')),20000);await state(second,'software-development','active');checks++;
 console.log(`PASS ${checks} live dependency checks: two independent browsers, API updates, explicit disable preserved, touch, four widths, reload.`);
}finally{
 for(const [id,enabled] of Object.entries(originals))await call('/plugins/'+id,'PATCH',{enabled}).catch(error=>console.error('Restore failed',error.message));if(first)await first.quit();if(second)await second.quit();await pool.end();
}
