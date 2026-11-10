import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import {Pool} from 'pg';
import {Builder,By,until} from 'selenium-webdriver';
import {Options} from 'selenium-webdriver/chrome.js';
import {mkdir,writeFile} from 'node:fs/promises';
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
dotenv.config({path:resolve(root,'apps/api/.env'),quiet:true});
const u=new URL(process.env.DATABASE_URL);u.hostname=process.env.ORBIT_SELENIUM_DB_HOST||'127.0.0.1';
const db=new Pool({connectionString:u.toString()});
const user=(await db.query('SELECT id,name,email FROM users ORDER BY created_at LIMIT 1')).rows[0];
const token=jwt.sign({sub:user.id,email:user.email},process.env.JWT_SECRET,{expiresIn:'10m'});
const base=process.env.ORBIT_SELENIUM_BASE_URL||'http://127.0.0.1:3001';
const apiBase=process.env.ORBIT_SELENIUM_API_URL||'http://127.0.0.1:4001';
async function request(path,method='GET',body,status=200){const r=await fetch(apiBase+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d}
let board,driver;
try{
 const contract=await request('/architecture');
 assert.equal(contract.cardInterface.executionConfiguration,'backend');
 const obsolete=contract.cardInterface.obsoletePanels;
 assert.deepEqual(obsolete,['Execução opcional','Contexto','Limites de alteração','Integrações']);
 const response=await fetch(apiBase+'/boards',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({title:'Architecture validation '+Date.now()})});assert.equal(response.status,201);board=await response.json();
 const policy=(await db.query('SELECT reference_board_id FROM board_architecture_contracts WHERE board_id=$1',[board.id])).rows[0];assert.ok(policy,'new boards must inherit the native architecture reference');
 const l=await request('/boards/'+board.id+'/lists','POST',{title:'Tasks'},201);
 await request('/lists/'+l.id+'/cards','POST',{title:'Rejected',priority:'invented'},400);
 const parent=await request('/lists/'+l.id+'/cards','POST',{title:'Project context'},201);
 const support=await request('/lists/'+l.id+'/cards','POST',{title:'Current design'},201);
 await request('/cards/'+parent.id+'/contexts','PATCH',{ids:[support.id]});
 const checklist=await request('/cards/'+parent.id+'/checklists','POST',{title:'Checklist'},201);
 const [item]=await request('/checklists/'+checklist.id+'/items','POST',{text:'Module'},201);
 const module=await request('/checklist-items/'+item.id+'/convert','POST',{},201);
 const mc=await request('/cards/'+module.id+'/checklists','POST',{title:'Checklist'},201);
 assert.equal((await request('/cards/'+module.id+'/checklists','POST',{title:'Another'},201)).id,mc.id);
 const [demandItem]=await request('/checklists/'+mc.id+'/items','POST',{text:'Demand'},201);
 const demand=await request('/checklist-items/'+demandItem.id+'/convert','POST',{},201);
 assert.deepEqual((await request('/cards/'+demand.id+'/contexts')).selected.map(c=>c.id),[module.id,parent.id,support.id]);
 await request('/cards/'+demand.id,'PATCH',{status:'invented'},400);
 await request('/boards/'+board.id+'/custom-fields','POST',{name:'Invented priority',type:'text'},409);
 const configured=(await db.query(`SELECT c.id,c.url_token,c.title,l.board_id,e.context
   FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id
   JOIN card_execution_configs e ON e.card_id=c.id
   WHERE b.owner_id=$1 AND c.archived_at IS NULL AND e.enabled AND e.context ? 'write_scope'
   ORDER BY (lower(b.title) LIKE '%meada%') DESC,c.created_at LIMIT 1`,[user.id])).rows[0];
 assert.ok(configured,'A configured demand is required to validate this regression');
 const snapshot=(await request('/cards/'+configured.id+'/execution')).execution;
 await request('/cards/'+demand.id+'/prompt-settings','PATCH',{ai_project_id:snapshot.project_id});
 await request('/cards/'+demand.id+'/execution','PATCH',{...snapshot,context:{...snapshot.context,cards:[]}});
 const reference=(await db.query(`SELECT c.id,c.title,c.url_token,l.board_id FROM cards c JOIN lists l ON l.id=c.list_id
   WHERE l.board_id=$1 AND c.archived_at IS NULL ORDER BY c.created_at LIMIT 1`,[policy.reference_board_id])).rows[0];
 assert.ok(reference,'The Orbit reference card must also be checked');
 const cases=[{...demand,board_id:board.id,title:'Demand',case:'converted-configured'}, {...configured,case:'existing-configured'}, {...reference,case:'orbit-reference'}];
 const artifacts=resolve(root,'.orbit/validations/architecture-contract/artifacts/current-card-ui');
 await mkdir(artifacts,{recursive:true,mode:0o700});
 const proof=[];
 console.log('PASS API: strict fields, reference policy, single checklist, inherited principal/module contexts');
 driver=await new Builder().forBrowser('chrome').setChromeOptions(new Options().addArguments('--headless=new','--no-sandbox','--disable-dev-shm-usage')).build();
 await driver.get(base);await driver.executeScript('localStorage.setItem("orbit_token",arguments[0]);localStorage.setItem("orbit_user",arguments[1])',token,JSON.stringify(user));
 for(const width of [390,1440]){
  await driver.sendAndGetDevToolsCommand('Emulation.setTouchEmulationEnabled',{enabled:width<768});
  for(const item of cases){
  await driver.sendAndGetDevToolsCommand('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<768});
  await driver.get(`${base}/board/${item.board_id}?card=${item.id}&token=${item.url_token}`);
  const dialog=await driver.wait(until.elementLocated(By.css('[role="dialog"]')),15000);
  await driver.wait(async()=>/Contextos/.test(await dialog.getText()),15000);
  assert.equal(await dialog.findElement(By.css('input[maxlength="300"]')).getAttribute('value'),item.title);
  assert.equal((await dialog.findElements(By.css('[aria-label="Capacidades do cartão"]'))).length,0,'Legacy execution region returned');
  for(const label of obsolete)assert.equal((await dialog.findElements(By.xpath(`.//summary[normalize-space()="${label}" or starts-with(normalize-space(),"${label} ")]`))).length,0,`Obsolete panel: ${label}`);
  assert.ok((await dialog.getText()).includes('IA do cartão'));
  const bounds=await driver.executeScript(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth}},dialog);assert.ok(bounds.left>=0&&bounds.right<=bounds.width+1);
  await writeFile(resolve(artifacts,`${item.case}-${width}.png`),await driver.takeScreenshot(),'base64');
  for(const tab of ['Próximo prompt','Execução']){
   const button=await dialog.findElement(By.xpath(`.//button[normalize-space()="${tab}"]`));
   await driver.executeScript('arguments[0].scrollIntoView({block:"center",behavior:"instant"})',button);
   if(width<768){const point=await driver.executeScript(el=>{const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}},button);await driver.sendAndGetDevToolsCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1}]});await driver.sendAndGetDevToolsCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else await button.click();
   await driver.wait(async()=>tab==='Próximo prompt'?(await dialog.findElements(By.css('[aria-label="Próximo prompt"]'))).length>0:(await dialog.findElement(By.css('[aria-label="Execução de prompt"]'))).isDisplayed(),10000);
   assert.equal((await dialog.findElements(By.css('[aria-label="Capacidades do cartão"]'))).length,0);
  }
  proof.push({case:item.case,width,legacyPanels:false,currentTabs:true,bounds:'passed'});
  console.log(`PASS UI ${width}px ${item.case}: obsolete panels absent, live contexts and current prompt/execution tabs`);
  }
 }
 assert.deepEqual((await request('/cards/'+configured.id+'/execution')).execution,snapshot,'Viewing the card changed its backend execution configuration');
 assert.deepEqual((await request('/cards/'+demand.id+'/contexts')).selected.map(c=>c.id),[module.id,parent.id,support.id]);
 await writeFile(resolve(artifacts,'report.json'),JSON.stringify({date:new Date().toISOString(),checks:proof,executionConfig:'preserved',contexts:'preserved'},null,2),{mode:0o600});
}finally{if(driver)await driver.quit();if(board)await db.query('DELETE FROM boards WHERE id=$1',[board.id]);await db.end()}
