import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import {Pool} from 'pg';
import {Builder,By,until} from 'selenium-webdriver';
import {Options} from 'selenium-webdriver/chrome.js';
dotenv.config({path:'apps/api/.env',quiet:true});
const url=new URL(process.env.DATABASE_URL);url.hostname=process.env.ORBIT_SELENIUM_DB_HOST||url.hostname;const pool=new Pool({connectionString:url.toString()});
const root=(await pool.query('SELECT id,email,session_version FROM users WHERE is_root ORDER BY created_at LIMIT 1')).rows[0];
const rootToken=jwt.sign({sub:root.id,email:root.email,version:root.session_version},process.env.JWT_SECRET,{expiresIn:'20m'});
const suffix=randomUUID().slice(0,8),email=`queue-${suffix}@orbit.example.test`,password=randomUUID()+randomUUID();let user,board,project,workspace,driver;let checks=0;
async function call(path,{method='GET',body,token=rootToken,status=200}={}){const response=await fetch('http://127.0.0.1:4001'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json();assert.equal(response.status,status,`${method} ${path}: ${data.message||response.status}`);checks++;return data}
async function tap(element){await driver.executeScript(e=>e.scrollIntoView({block:'center'}),element);await driver.executeAsyncScript(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));const p=await driver.executeScript(e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}},element);await driver.sendAndGetDevToolsCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1,radiusX:2,radiusY:2,force:1}]});await driver.sendAndGetDevToolsCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
try{
 user=await call('/access/users',{method:'POST',body:{name:'Queue fixture '+suffix,email,password,roles:['administrator']},status:201});
 const session=await call('/auth/login',{method:'POST',body:{email,password},status:201});const token=session.token;const account=await call('/auth/me',{token});
 await call('/codex/queue',{method:'PATCH',body:{paused:true},token});
 project=(await pool.query('INSERT INTO ai_projects(owner_id,name,local_path) VALUES($1,$2,$3) RETURNING id',[user.id,'Queue project '+suffix,'/tmp/orbit-queue-'+suffix])).rows[0];
 workspace=await call('/workspaces',{method:'POST',body:{name:'Queue workspace '+suffix},token,status:201});board=await call('/boards',{method:'POST',body:{title:'Queue board '+suffix,workspace_id:workspace.id},token,status:201});const list=await call(`/boards/${board.id}/lists`,{method:'POST',body:{title:'Fixtures'},token,status:201});const card=await call(`/lists/${list.id}/cards`,{method:'POST',body:{title:'Queue pending card '+suffix},token,status:201});
 await pool.query("INSERT INTO card_ai_runs(card_id,project_id,user_id,model,effort,prompt,status,output) VALUES($1,$2,$3,'gpt-6-luna','medium','Private fixture prompt','waiting_answer','Private fixture answer')",[card.id,project.id,user.id]);
 const comment=(await pool.query('INSERT INTO comments(card_id,author_id,body) VALUES($1,$2,$3) RETURNING id',[card.id,user.id,'Private fixture comment'])).rows[0];
 await pool.query("INSERT INTO card_ai_comment_jobs(comment_id,card_id,user_id,project_id,model,effort,status) VALUES($1,$2,$3,$4,'gpt-6-luna','medium','queued')",[comment.id,card.id,user.id,project.id]);
 const own=await call('/codex/queues',{token});assert.equal(own.root,false);assert.ok(own.queues.every(queue=>queue.ownerId===user.id));assert.ok(own.queues.find(queue=>queue.kind==='comment').items.some(item=>item.id===comment.id));assert.ok(!JSON.stringify(own).includes('Private fixture'));checks++;
 const all=await call('/codex/queues');assert.ok(all.queues.some(queue=>queue.ownerId===user.id));checks++;
 await call('/codex/queue',{method:'PATCH',body:{userId:root.id,paused:true},token,status:403});await call('/codex/queue',{method:'PATCH',body:{autoResume:'yes'},token,status:400});
 driver=await new Builder().forBrowser('chrome').setChromeOptions(new Options().addArguments('--headless=new','--no-sandbox','--disable-dev-shm-usage')).build();await driver.manage().window().setRect({width:1440,height:1000});await driver.get('http://127.0.0.1:3001');await driver.executeScript('localStorage.setItem("orbit_token",arguments[0]);localStorage.setItem("orbit_user",arguments[1])',token,JSON.stringify(account));await driver.get('http://127.0.0.1:3001/boards');await driver.wait(until.elementLocated(By.xpath("//button[contains(.,'Limites')]")),15000);await (await driver.findElement(By.xpath("//button[contains(.,'Limites')]"))).click();
 const toggle=await driver.wait(until.elementLocated(By.css('#codex-limits-bar [role="switch"]')),15000);await driver.wait(until.elementIsEnabled(toggle),15000);await tap(await toggle.findElement(By.xpath('..')));await driver.wait(async()=>(await call('/codex/queue',{token})).autoResume,10000);assert.equal((await call('/codex/queue',{token})).paused,true);checks++;
 const order=await driver.executeScript(()=>{const bar=document.getElementById('codex-limits-bar');const controls=[...bar.querySelectorAll('[role=switch],button,a')];return controls.map(element=>element.tagName)});assert.deepEqual(order.slice(0,3),['INPUT','BUTTON','A']);checks++;
 await tap(await driver.findElement(By.css('#codex-limits-bar a[href="/queues"]')));await driver.wait(until.urlContains('/queues'),10000);await driver.wait(until.elementLocated(By.css('[data-queue-kind="comment"]')),15000);assert.match(await driver.findElement(By.css('main')).getText(),/Aguardando resposta/);checks++;
 for(const width of [320,375,768,1440]){
  await driver.sendAndGetDevToolsCommand('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<1000});await driver.sendAndGetDevToolsCommand('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const metrics=await driver.executeScript(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,targets:[...document.querySelectorAll('main button,main label,main a')].filter(element=>element.getBoundingClientRect().height).map(element=>element.getBoundingClientRect().height)}));assert.ok(metrics.scroll<=metrics.width+1,`${width}: overflow`);for(const height of metrics.targets)assert.ok(height>=44,`small target ${height}`);checks++;
 }
 const managerSwitch=await driver.findElement(By.css('[data-queue-kind="prompt"] input[role="switch"]'));assert.equal(await managerSwitch.isSelected(),true);await tap(await managerSwitch.findElement(By.xpath('..')));await driver.wait(async()=>!(await call('/codex/queue',{token})).autoResume,10000);checks++;
 await driver.navigate().refresh();await driver.wait(until.elementLocated(By.css('[data-queue-kind="prompt"] input[role="switch"]')),15000);assert.equal(await (await driver.findElement(By.css('[data-queue-kind="prompt"] input[role="switch"]'))).isSelected(),false);checks++;
 console.log(`PASS queues: ${checks} checks. Persistent toggle, bar order/link, contents, privacy, ROOT scope, four widths and touch. No prompt executed.`);
}finally{
 if(driver)await driver.quit();if(board)await pool.query('DELETE FROM boards WHERE id=$1',[board.id]);if(workspace)await pool.query('DELETE FROM workspaces WHERE id=$1',[workspace.id]);if(project)await pool.query('DELETE FROM ai_projects WHERE id=$1',[project.id]);if(user){await pool.query('DELETE FROM access_audit WHERE actor_id=$1',[user.id]);await pool.query('DELETE FROM users WHERE id=$1',[user.id]);}await pool.end();
}
