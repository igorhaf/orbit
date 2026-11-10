import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(process.cwd()+'/package.json');
const dotenv=require('dotenv'),jwt=require('jsonwebtoken'),{Pool}=require('pg'),{chromium}=require('playwright');
dotenv.config({path:'apps/api/.env',quiet:true});
const url=new URL(process.env.DATABASE_URL);url.hostname=process.env.ORBIT_SELENIUM_DB_HOST||'172.22.0.3';const pool=new Pool({connectionString:url.toString()});
let browser;
try {
 const user=(await pool.query('SELECT id,name,email FROM users WHERE email=$1',['igorhaf@gmail.com'])).rows[0];
 const token=jwt.sign({sub:user.id,email:user.email},process.env.JWT_SECRET,{expiresIn:'10m'});
 const response=await fetch('http://localhost:4001/plugins/alexa-orbit/interaction-model',{headers:{Authorization:`Bearer ${token}`}});
 assert.equal(response.status,200);const model=await response.json();
 const names=model.interactionModel.languageModel.intents.map(intent=>intent.name);
 for(const name of ['OrbitMessageIntent','OrbitStatusIntent'])assert.ok(names.includes(name));
 console.log('PASS authenticated voice model API: generic speech and status intents');
 browser=await chromium.launch({headless:true,executablePath:process.cwd()+'/.orbit/validations/prompt-questions/browser-cache/chromium-1243/chrome-linux64/chrome',args:['--no-sandbox']});
 for(const width of [320,390,1440]){
  const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<500});
  await page.addInitScript(({token,user})=>{localStorage.setItem('orbit_token',token);localStorage.setItem('orbit_user',JSON.stringify(user))},{token,user});
  await page.goto('http://localhost:3001/plugins?configure=alexa-orbit');
  await page.getByRole('dialog',{name:'Configurar Alexa Orbit'}).waitFor();
  const effort=page.getByRole('combobox',{name:'Esforço da IA por voz'});await effort.waitFor();assert.equal(await effort.inputValue(),'low');const button=page.getByRole('button',{name:'Copiar modelo de voz'});
  if(width<500)await button.tap();else await button.click();
  const textarea=page.getByRole('textbox',{name:'Modelo de voz pt-BR'});await textarea.waitFor();
  assert.deepEqual(JSON.parse(await textarea.inputValue()),model);
  const refresh=page.getByRole('button',{name:'Atualizar pedidos'});if(width<500)await refresh.tap();else await refresh.click();await page.waitForTimeout(300);const alert=page.getByRole('dialog',{name:'Configurar Alexa Orbit'}).getByRole('alert');if(await alert.count())throw new Error(await alert.innerText());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log(`PASS ${width}px: copy model, valid JSON, no page overflow`);await page.close();
 }
}finally{if(browser)await browser.close();await pool.end()}
