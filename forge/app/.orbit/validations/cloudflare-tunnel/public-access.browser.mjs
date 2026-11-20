import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const origin=process.env.ORBIT_TEST_PUBLIC_URL||'https://orbit.meadadigital.com';
const browser=await chromium.launch({headless:true,...(process.env.ORBIT_TEST_CHROME_BIN?{executablePath:resolve(process.env.ORBIT_TEST_CHROME_BIN)}:{}),args:['--no-sandbox']});
try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<500});const errors=[];let hmr=false;
 page.on('pageerror',error=>errors.push(error.message));
 page.on('websocket',socket=>{if(socket.url().includes('/_next/hmr')){socket.on('framereceived',()=>{hmr=true;});socket.on('socketerror',error=>errors.push(String(error)));}});
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 const submit=page.getByRole('button',{name:'Entrar',exact:true});await submit.waitFor({state:'visible'});
 await page.getByLabel('E-mail',{exact:true}).fill('visibility-test@example.invalid');
 const password=page.getByLabel('Senha',{exact:true});await password.fill('visibility-test-only');
 const reveal=page.getByRole('button',{name:'Mostrar senha',exact:true});if(width<500)await reveal.tap();else await reveal.click();assert.equal(await password.getAttribute('type'),'text');
 const hide=page.getByRole('button',{name:'Ocultar senha',exact:true});if(width<500)await hide.tap();else await hide.click();assert.equal(await password.getAttribute('type'),'password');
 const status=await page.evaluate(async()=>{const result=await fetch('/api/auth/me');return result.status;});assert.equal(status,401,'API should respond with authentication required, not a proxy failure');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'horizontal overflow');
 assert.equal(hmr,true,'DEV websocket must connect through the public hostname');assert.deepEqual(errors,[]);
 await password.fill('');await page.getByLabel('E-mail',{exact:true}).fill('');
 await page.screenshot({path:resolve(root,`.orbit/validations/cloudflare-tunnel/public-login-${width}.png`),fullPage:true});
 console.log(`PASS ${width}px: login visível, toque, API, HMR e layout pelo domínio público`);await page.close();
}}finally{await browser.close();}
