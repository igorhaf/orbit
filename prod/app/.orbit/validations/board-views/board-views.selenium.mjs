import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import {Pool} from 'pg';
import {Builder,By,until} from 'selenium-webdriver';
import {Options} from 'selenium-webdriver/chrome.js';

dotenv.config({path:'apps/api/.env',quiet:true});
const dbUrl=new URL(process.env.DATABASE_URL);dbUrl.hostname=process.env.ORBIT_SELENIUM_DB_HOST||dbUrl.hostname;
const pool=new Pool({connectionString:dbUrl.toString()});
const root=(await pool.query('SELECT id,name,email,is_root,session_version FROM users WHERE is_root ORDER BY created_at LIMIT 1')).rows[0];
const mint=user=>jwt.sign({sub:user.id,email:user.email,version:user.session_version||0},process.env.JWT_SECRET,{expiresIn:'20m'});
const rootToken=mint(root),base=process.env.ORBIT_SELENIUM_BASE_URL||'http://127.0.0.1:3001',apiBase=process.env.ORBIT_SELENIUM_API_URL||'http://127.0.0.1:4001';
let driver,board,member,group,pluginState,checks=0;
async function call(path,method='GET',body,token=rootToken,status){const response=await fetch(apiBase+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();if(status!==undefined)assert.equal(response.status,status,JSON.stringify(value));else assert.ok(response.ok,JSON.stringify(value));return value}
async function login(user){await driver.get(base);await driver.executeScript('localStorage.setItem("orbit_token",arguments[0]);localStorage.setItem("orbit_user",arguments[1])',mint(user),JSON.stringify(user));await driver.get(base+'/board/'+board.id);}
async function view(id){await driver.wait(until.elementLocated(By.css(`[data-board-view="${id}"]`)),20000);}
async function choose(id){const select=await driver.findElement(By.css('[aria-label="Visualização do quadro"]'));await driver.executeScript((element,value)=>{const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(element,value);element.dispatchEvent(new Event('change',{bubbles:true}))},select,id);await view(id);}
async function setInput(label,value){const element=await driver.findElement(By.css(`[aria-label="${label}"]`));await element.clear();if(value)await element.sendKeys(value);}
async function tap(element){await driver.executeScript(e=>e.scrollIntoView({block:'center'}),element);const point=await driver.executeScript(e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}},element);assert.ok(await driver.executeScript((e,p)=>e.contains(document.elementFromPoint(p.x,p.y)),element,point));await driver.sendAndGetDevToolsCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1,radiusX:2,radiusY:2,force:1}]});await driver.sendAndGetDevToolsCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
try{
  pluginState=(await call('/plugins')).plugins.find(plugin=>plugin.id==='structured-view').configuredEnabled;
  assert.ok(pluginState,'Structured plugin must be enabled for this validation.');
  board=await call('/boards','POST',{title:'Board views validation '+randomUUID().slice(0,8),background:'blue'});
  await pool.query('UPDATE boards SET workspace_id=NULL WHERE id=$1',[board.id]);
  const lists=[await call('/boards/'+board.id+'/lists','POST',{title:'Pendentes'})];
  const context=await call(`/lists/${lists[0].id}/cards`,'POST',{title:'Contexto de validação'});
  const module=await call(`/lists/${lists[0].id}/cards`,'POST',{title:'Módulo de validação'});
  const demand=await call(`/lists/${lists[0].id}/cards`,'POST',{title:'Demanda móvel de validação'});
  await call(`/cards/${module.id}/contexts`,'PATCH',{ids:[context.id]});
  await call(`/cards/${demand.id}/contexts`,'PATCH',{ids:[context.id,module.id]});
  const moduleRelations=await call(`/cards/${module.id}/contexts`);
  assert.ok(moduleRelations.children.some(child=>child.id===demand.id));
  assert.ok(moduleRelations.selected.some(parent=>parent.id===context.id));checks+=2;
  member=(await pool.query("INSERT INTO users(name,email,password_hash) VALUES('Views validation',$1,'!unusable-test-password') RETURNING id,name,email,is_root,session_version",['views-'+randomUUID()+'@example.invalid'])).rows[0];
  group=(await pool.query("INSERT INTO access_groups(name,permissions) VALUES('Views validation',ARRAY['boards.read','views.structured.use']) RETURNING id")).rows[0];
  await pool.query('INSERT INTO access_group_members(group_id,user_id) VALUES($1,$2)',[group.id,member.id]);
  await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'member')",[board.id,member.id]);
  const memberToken=mint(member),options=await call(`/boards/${board.id}/views`,'GET',undefined,memberToken);
  assert.deepEqual(options.views.map(view=>view.id),['structured']);assert.equal(options.canWrite,false);
  await call(`/boards/${board.id}/views`,'PATCH',{viewId:'board'},memberToken,403);
  await call(`/boards/${board.id}/views/board/relations`,'GET',undefined,memberToken,403);
  await call(`/lists/${lists[0].id}/cards`,'POST',{title:'Forbidden'},memberToken,403);checks+=4;
  driver=await new Builder().forBrowser('chrome').setChromeOptions(new Options().addArguments('--headless=new','--no-sandbox','--disable-dev-shm-usage')).build();
  await driver.manage().window().setRect({width:1440,height:1000});await login(root);await view('board');await choose('structured');
  await driver.wait(async()=>Number(await (await driver.findElement(By.css(`[data-demand-id="${demand.id}"]`))).getAttribute('data-hierarchy-depth'))===2,10000);checks++;
  assert.match(await (await driver.findElement(By.css(`[data-demand-id="${demand.id}"]`))).getText(),/Filho de: Módulo de validação/);checks++;
  await setInput('Pesquisar demandas','Demanda móvel');assert.equal((await driver.findElements(By.css('[data-demand-id]'))).length,3);
  await setInput('Nome do filtro','Demandas móveis');await (await driver.findElement(By.css('[aria-label="Salvar filtro"]'))).click();
  await driver.wait(async()=>(await call(`/boards/${board.id}/views`)).savedFilters.length===1,10000);checks++;
  assert.equal((await call(`/boards/${board.id}/views`,'GET',undefined,memberToken)).savedFilters.length,0);checks++;
  await driver.navigate().refresh();await view('structured');assert.equal(await (await driver.findElement(By.css('[aria-label="Visualização do quadro"]'))).getAttribute('value'),'structured');
  await driver.wait(until.elementLocated(By.xpath("//button[normalize-space()='Demandas móveis']")),10000);await (await driver.findElement(By.xpath("//button[normalize-space()='Demandas móveis']"))).click();
  assert.equal(await (await driver.findElement(By.css('[aria-label="Pesquisar demandas"]'))).getAttribute('value'),'Demanda móvel');checks++;
  for(const width of [320,375,768,1440]){
    await driver.sendAndGetDevToolsCommand('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<1000});await driver.sendAndGetDevToolsCommand('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    const metrics=await driver.executeScript(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(metrics.scroll<=metrics.width+1,'Page overflow at '+width);
    await tap(await driver.findElement(By.css(`[aria-label="Abrir ${demand.title}"]`)));await driver.wait(until.elementLocated(By.css('[role="dialog"][aria-modal="true"]')),10000);
    const panel=await driver.findElement(By.css('[role="dialog"][aria-modal="true"]'));const rect=await panel.getRect();assert.ok(rect.width<=width+1);assert.ok(rect.x>=0&&rect.x+rect.width<=width+1);assert.ok(Math.abs(rect.x-(width-rect.width)/2)<=2);
    await tap(await panel.findElement(By.css('[aria-label="Fechar"]')));await driver.wait(async()=>(await driver.findElements(By.css('[role="dialog"][aria-modal="true"]'))).length===0,10000);
    assert.equal(await (await driver.findElement(By.css('[aria-label="Pesquisar demandas"]'))).getAttribute('value'),'Demanda móvel');checks++;
  }
  await driver.sendAndGetDevToolsCommand('Emulation.setDeviceMetricsOverride',{width:375,height:1000,deviceScaleFactor:1,mobile:true});
  await login(member);await view('structured');assert.equal((await driver.findElements(By.css('[aria-label="Visualização do quadro"]'))).length,0);assert.equal((await driver.findElements(By.xpath("//button[normalize-space()='Novo cartão']"))).length,0);checks++;
  await call('/plugins/structured-view','PATCH',{enabled:false});
  await driver.wait(until.elementLocated(By.xpath("//*[@role='status' and contains(.,'Nenhuma visualização')]")),10000);
  await call(`/boards/${board.id}/views/structured/relations`,'GET',undefined,memberToken,403);checks++;
  await call('/plugins/structured-view','PATCH',{enabled:true});await view('structured');checks++;
  console.log(`PASS ${checks} board view checks: RBAC, read-only access, hierarchy, private saved filters, persisted view, panel, four widths and touch, live plugin availability.`);
}finally{
  if(driver)await driver.quit();
  if(pluginState!==undefined)await call('/plugins/structured-view','PATCH',{enabled:pluginState});
  if(board)await call('/boards/'+board.id,'DELETE');
  if(group)await pool.query('DELETE FROM access_groups WHERE id=$1',[group.id]);
  if(member)await pool.query('DELETE FROM users WHERE id=$1',[member.id]);
  await pool.end();
}
