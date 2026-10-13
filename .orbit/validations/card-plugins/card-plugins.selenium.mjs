import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import {Pool} from 'pg';
import {Builder,By,until} from 'selenium-webdriver';
import {Options} from 'selenium-webdriver/chrome.js';
dotenv.config({path:'apps/api/.env',quiet:true});
const url=new URL(process.env.DATABASE_URL);url.hostname=process.env.ORBIT_SELENIUM_DB_HOST||url.hostname;const pool=new Pool({connectionString:url.toString()});
const root=(await pool.query('SELECT id,name,email,is_root,session_version FROM users WHERE is_root ORDER BY created_at LIMIT 1')).rows[0];
const token=jwt.sign({sub:root.id,email:root.email,version:root.session_version},process.env.JWT_SECRET,{expiresIn:'20m'});
const base=process.env.ORBIT_SELENIUM_BASE_URL||'http://127.0.0.1:3001',apiBase='http://127.0.0.1:4001';let board,driver;let checks=0;
async function call(path,method='GET',body,status=200){const response=await fetch(apiBase+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json();assert.equal(response.status,status,`${path}: ${response.status} ${data.message||''}`);checks++;return data}
async function tap(element){await driver.executeScript(e=>e.scrollIntoView({block:'center'}),element);const p=await driver.executeScript(e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}},element);await driver.sendAndGetDevToolsCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1,radiusX:2,radiusY:2,force:1}]});await driver.sendAndGetDevToolsCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
async function visibleText(text){return driver.findElements(By.xpath(`//*[self::button or self::h3 or self::strong or self::span][contains(.,'${text}')]`)).then(async elements=>(await Promise.all(elements.map(element=>element.isDisplayed()))).some(Boolean))}
try{
 board=await call('/boards','POST',{title:'Card plugins validation '+randomUUID().slice(0,8)},201);const list=await call(`/boards/${board.id}/lists`,'POST',{title:'Validation'},201);const card=await call(`/lists/${list.id}/cards`,'POST',{title:'Plugin layout fixture'},201);
 assert.deepEqual((await call(`/cards/${card.id}/plugins`)).selected,[]);
 await call(`/cards/${card.id}/ai`,'POST',{action:'refine'},409);
 await call(`/cards/${card.id}/plugins`,'PATCH',{plugins:['not-installed']},409);
 const comment=await call(`/cards/${card.id}/comments`,'POST',{body:'Basic comment; no AI.'},201);assert.ok(comment.id);
 driver=await new Builder().forBrowser('chrome').setChromeOptions(new Options().addArguments('--headless=new','--no-sandbox','--disable-dev-shm-usage')).build();await driver.get(base);await driver.executeScript('localStorage.setItem("orbit_token",arguments[0]);localStorage.setItem("orbit_user",arguments[1])',token,JSON.stringify(root));
 for(const width of [320,375,768,1440]){
  await call(`/cards/${card.id}/plugins`,'PATCH',{plugins:[]});
  await driver.sendAndGetDevToolsCommand('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<1000});await driver.sendAndGetDevToolsCommand('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await driver.get(`${base}/board/${board.id}?card=${card.id}&token=${card.url_token}`);await driver.wait(until.elementLocated(By.css('[data-testid="card-plugins"]')),15000);
  assert.equal(await visibleText('Próximo prompt'),false);assert.equal(await visibleText('IA do cartão'),false);checks++;
  await tap(await driver.findElement(By.css('[data-testid="card-plugins"] summary')));await driver.wait(until.elementIsVisible(await driver.findElement(By.css('[data-testid="card-plugins"] input'))),5000);
  const development=await driver.findElement(By.xpath("//*[@data-testid='card-plugins']//label[contains(.,'Desenvolvimento de software')]"));await tap(development);
  await driver.wait(async()=>await visibleText('Próximo prompt'),10000);assert.deepEqual((await call(`/cards/${card.id}/plugins`)).selected,['ai','software-development']);assert.ok(await visibleText('IA do cartão'));checks++;
  const labels=await driver.executeScript(()=>[...document.querySelectorAll('[data-testid="card-plugins"] label')].map(e=>{const r=e.getBoundingClientRect();return {height:r.height,width:r.width,x:r.x,right:r.right}}));for(const label of labels){assert.ok(label.height>=44);assert.ok(label.x>=0&&label.right<=width+1)}checks++;
  const ai=await driver.findElement(By.xpath("//*[@data-testid='card-plugins']//label[.//span[contains(.,'Inteligência artificial')]][1]"));await tap(ai);await driver.wait(async()=>!(await visibleText('Próximo prompt')),10000);assert.deepEqual((await call(`/cards/${card.id}/plugins`)).selected,[]);assert.equal(await visibleText('IA do cartão'),false);assert.ok(await visibleText('Editar descrição'));checks++;
  const overflow=await driver.executeScript(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);checks++;
  console.log(`PASS ${width}px basic → development + AI → basic, touch and visibility`);
 }
 await call(`/cards/${card.id}/plugins`,'PATCH',{plugins:['software-development']});
 const extensions=await call(`/cards/${card.id}/extensions`);const checklist=extensions.checklists[0]||await call(`/cards/${card.id}/checklists`,'POST',{title:'Checklist'},201);
 const items=await call(`/checklists/${checklist.id}/items`,'POST',{text:'Inherited plugin demand'},201);const child=await call(`/checklist-items/${items[0].id}/convert`,'POST',{list_id:list.id},201);
 assert.deepEqual((await call(`/cards/${child.id}/plugins`)).selected,['ai','software-development']);
 const copied=await call('/cards/copy','POST',{card_ids:[card.id],list_id:list.id},201);assert.ok(copied);
 const all=await call(`/boards/${board.id}`);const copy=all.lists.flatMap(item=>item.cards).find(item=>item.id!==card.id&&item.id!==child.id&&item.title===card.title);assert.ok(copy);assert.deepEqual((await call(`/cards/${copy.id}/plugins`)).selected,['ai','software-development']);
 // Inspect global dependency gating without invoking any model.
 const settings=await call('/plugins');const aiState=settings.plugins.find(plugin=>plugin.id==='ai').configuredEnabled;
 try{
  await call('/plugins/ai','PATCH',{enabled:false});const disabled=await call('/plugins');assert.equal(disabled.plugins.find(plugin=>plugin.id==='software-development').enabled,false);assert.equal(disabled.plugins.find(plugin=>plugin.id==='alexa-orbit').enabled,false);
  await call('/ai/models','GET',undefined,409);await call('/ai/projects');await call(`/cards/${card.id}/plugins`,'PATCH',{plugins:['software-development']},409);
 }finally{await call('/plugins/ai','PATCH',{enabled:aiState})}
 assert.equal((await call('/cards/'+card.id+'/details')).comments.some(item=>item.id===comment.id),true);
 console.log(`PASS card plugins: ${checks} checks. No prompt executed.`);
}finally{if(driver)await driver.quit();if(board)await pool.query('DELETE FROM boards WHERE id=$1',[board.id]);await pool.end()}
