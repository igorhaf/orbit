import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import * as jwt from 'jsonwebtoken';
import { Db } from './db';

test('column Trello settings, project UI cleanup and confirmation modals render correctly',async()=>{
  const db=new Db(),user=await db.one<{id:string;name:string;email:string}>('SELECT id,name,email FROM users WHERE email=$1',['igorhaf@gmail.com']);assert.ok(user);
  const token=jwt.sign({sub:user.id,email:user.email},process.env.JWT_SECRET!,{expiresIn:'10m'}),board=(await db.one<{id:string}>("INSERT INTO boards(title,owner_id) VALUES('Pending fixes browser test',$1) RETURNING id",[user.id]))!.id;
  await db.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')",[board,user.id]);
  const list=(await db.one<{id:string}>("INSERT INTO lists(board_id,title) VALUES($1,'Local column') RETURNING id",[board]))!.id,card=(await db.one<{id:string}>("INSERT INTO cards(list_id,title) VALUES($1,'Local card') RETURNING id",[list]))!.id;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900}});await context.addInitScript(({token,user})=>{localStorage.setItem('orbit_token',token);localStorage.setItem('orbit_user',JSON.stringify(user))},{token,user});
    const page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${process.env.WEB_ORIGIN||'http://localhost:3000'}/board/${board}?card=${card}`);
    await page.getByRole('heading',{name:'Atividade'}).waitFor();
    assert.equal(await page.getByText('Anexar cartão ou quadro',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Arquivar',exact:true}).click();
    await page.getByRole('heading',{name:'Arquivar cartão'}).waitFor();
    await page.getByRole('button',{name:'Cancelar',exact:true}).click();
    await page.getByLabel('Fechar').first().click();
    await page.getByLabel('Menu da lista Local column').click();
    await page.getByRole('button',{name:'Integração Trello',exact:true}).click();
    await page.getByText('Vincule esta coluna local a uma coluna do Trello. Somente os cartões dessas duas colunas serão sincronizados.').waitFor();
    await page.getByText('Conecte primeiro um quadro Trello no menu do quadro.').waitFor();
    assert.deepEqual(errors,[]);await context.close();
  }finally{await browser.close();await db.query('DELETE FROM boards WHERE id=$1',[board]);await db.onModuleDestroy();}
});

test('header search opens boards, focuses lists, and opens cards in their board',async()=>{
  const db=new Db(),user=await db.one<{id:string;name:string;email:string}>('SELECT id,name,email FROM users WHERE email=$1',['igorhaf@gmail.com']);assert.ok(user);
  const suffix=Date.now().toString(),boardTitle=`Search board ${suffix}`,listTitle=`Search list ${suffix}`,cardTitle=`Search card ${suffix}`;
  const token=jwt.sign({sub:user.id,email:user.email},process.env.JWT_SECRET!,{expiresIn:'10m'}),board=(await db.one<{id:string}>('INSERT INTO boards(title,owner_id) VALUES($1,$2) RETURNING id',[boardTitle,user.id]))!.id;
  await db.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')",[board,user.id]);
  const list=(await db.one<{id:string}>("INSERT INTO lists(board_id,title) VALUES($1,$2) RETURNING id",[board,listTitle]))!.id;
  await db.query('INSERT INTO cards(list_id,title) VALUES($1,$2)',[list,cardTitle]);
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    await context.addInitScript(({token,user})=>{localStorage.setItem('orbit_token',token);localStorage.setItem('orbit_user',JSON.stringify(user))},{token,user});
    const page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    assert.equal(await page.evaluate(async()=>{const response=await fetch('/api/search?q=unauthenticated');return response.status}),401,'search must require an authenticated API request');
    const search=async(term:string)=>{await page.getByRole('button',{name:'Pesquisar em todos os quadros'}).click();const input=page.getByPlaceholder('Pesquisar cartões e quadros...');await input.fill(term);};
    await page.goto(`${process.env.WEB_ORIGIN||'http://localhost:3000'}/boards`);
    await search(boardTitle);
    await page.getByRole('button',{name:`Abrir quadro ${boardTitle}`}).click();
    await page.waitForURL(`**/board/${board}`);

    await search(boardTitle);
    const boardUrl=page.url();
    await page.getByRole('button',{name:`Abrir quadro ${boardTitle}`}).click();
    assert.equal(page.url(),boardUrl,'opening the current board should keep the current location');

    await search(listTitle);
    await page.getByRole('button',{name:`Abrir lista ${listTitle} no quadro ${boardTitle}`}).click();
    await page.waitForURL(`**/board/${board}?list=${list}`);
    await page.waitForFunction('id => document.activeElement?.getAttribute("data-orbit-list") === id',list);

    await search(cardTitle);
    await page.getByRole('button',{name:`Abrir cartão ${cardTitle} no quadro ${boardTitle}`}).click();
    await page.waitForURL(url=>url.pathname===`/board/${board}`&&url.searchParams.get('card')!==null&&url.searchParams.get('list')===list);
    await page.getByRole('dialog').waitFor();
    assert.deepEqual(errors,[]);
    await context.close();
  }finally{await browser.close();await db.query('DELETE FROM boards WHERE id=$1',[board]);await db.onModuleDestroy();}
});
