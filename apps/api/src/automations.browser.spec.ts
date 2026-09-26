import 'dotenv/config';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright';
import * as jwt from 'jsonwebtoken';
import {Db} from './db';

test('automation builder and buttons work on desktop and mobile',async()=>{
  const db=new Db();
  const user=await db.one('SELECT id,name,email FROM users WHERE email=$1',['igorhaf@gmail.com']);
  assert.ok(user,'Run migrations before browser tests.');
  const token=jwt.sign({sub:user.id,email:user.email},process.env.JWT_SECRET!,{expiresIn:'10m'});
  const board=(await db.one("INSERT INTO boards(title,owner_id) VALUES('Automation browser test',$1) RETURNING id",[user.id]))!.id;
  await db.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')",[board,user.id]);
  const list=(await db.one("INSERT INTO lists(board_id,title,position) VALUES($1,'Tasks',0) RETURNING id",[board]))!.id;
  const card=(await db.one("INSERT INTO cards(list_id,title) VALUES($1,'Browser card') RETURNING id",[list]))!.id;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
    const context=await browser.newContext({viewport:{width:1365,height:900}});
    await context.addInitScript(({token,user})=>{localStorage.setItem('orbit_token',token);localStorage.setItem('orbit_user',JSON.stringify(user))},{token,user});
    const page=await context.newPage();
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${process.env.WEB_ORIGIN||'http://localhost:3000'}/board/${board}`);
    await page.getByRole('button',{name:'Automação',exact:true}).click();
    await page.getByRole('button',{name:'Nova automação',exact:true}).click();
    await page.getByLabel('Nome',{exact:true}).fill('Complete test cards');
    await page.getByLabel('Gatilho',{exact:true}).selectOption('board_button');
    await page.getByLabel('Ação',{exact:true}).selectOption('complete');
    await page.getByRole('button',{name:'Salvar automação',exact:true}).click();
    await page.getByRole('heading',{name:'Complete test cards',exact:true}).waitFor();
    await page.getByRole('button',{name:'Fechar',exact:true}).click();
    await page.getByRole('button',{name:'Complete test cards',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Executado: 1 alterações.'}).waitFor();
    assert.equal((await db.one('SELECT completed FROM cards WHERE id=$1',[card]))?.completed,true);
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'Automação',exact:true}).click();
    await page.getByRole('button',{name:'Editar',exact:true}).click();
    await page.getByLabel('Gatilho',{exact:true}).selectOption('scheduled');
    await page.getByLabel('Frequência',{exact:true}).selectOption('weekly');
    await page.getByLabel('Dia da semana',{exact:true}).selectOption('2');
    await page.getByLabel('Ação',{exact:true}).selectOption('report');
    await page.getByLabel('Modelo de relatório',{exact:true}).selectOption('custom');
    await page.getByLabel('Destinatários (separados por vírgula)',{exact:true}).fill('test@example.invalid');
    await page.getByRole('button',{name:'+ Condição',exact:true}).click();
    await page.getByLabel('Propriedade',{exact:true}).selectOption('completed');
    await page.getByLabel('Valor',{exact:true}).selectOption('true');
    assert.ok(await page.getByRole('button',{name:'Salvar automação',exact:true}).isVisible());
    const overflow=await page.evaluate<boolean>('document.documentElement.scrollWidth > window.innerWidth');
    assert.equal(overflow,false,'Mobile document must not overflow horizontally.');
    await page.screenshot({path:'/tmp/orbit-automations-mobile.png',fullPage:true});
    // Do not save a scheduled report to an external address during UI tests.
    assert.deepEqual(errors,[]);
    await context.close();
  }finally{await browser.close();await db.query('DELETE FROM boards WHERE id=$1',[board]);await db.onModuleDestroy()}
});
