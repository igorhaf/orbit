import 'dotenv/config';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import * as jwt from 'jsonwebtoken';
import {Db} from '../db';

test('optional execution config, real plugin run and history work on desktop and mobile',{timeout:60000},async()=>{
  const db=new Db(),root=await mkdtemp(tmpdir()+'/orbit-browser-');
  const user=(await db.one('SELECT id,name,email FROM users ORDER BY created_at LIMIT 1'))!;
  const token=jwt.sign({sub:user.id,email:user.email},process.env.JWT_SECRET!,{expiresIn:'10m'});
  const board=(await db.one("INSERT INTO boards(title,owner_id) VALUES('Execution browser test',$1) RETURNING id",[user.id]))!.id;
  let project:string|undefined;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
    await mkdir(root+'/.orbit');await writeFile(root+'/.orbit/orbit.yaml','plugins: [filesystem]\npermissions: [filesystem.read]\nexecution:\n  executor: plugin\n  action: execute\n  permissions: [filesystem.read]\n');await writeFile(root+'/selected.txt','ORBIT_BROWSER_OK');
    project=(await db.one("INSERT INTO ai_projects(name,local_path,owner_id) VALUES('Execution browser fixture',$1,$2) RETURNING id",[root,user.id]))!.id;
    await db.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'owner')",[board,user.id]);
    const list=(await db.one("INSERT INTO lists(board_id,title,position) VALUES($1,'Tasks',0) RETURNING id",[board]))!.id;
    const review=(await db.one("INSERT INTO lists(board_id,title,position) VALUES($1,'Review',1) RETURNING id",[board]))!.id;
    await db.query('UPDATE lists SET is_completion_list=true WHERE id=$1',[review]);
    const card=(await db.one("INSERT INTO cards(list_id,title,ai_project_id) VALUES($1,'Executable browser card',$2) RETURNING id",[list,project]))!.id;
    const context=await browser.newContext({viewport:{width:1365,height:1000}});
    await context.addInitScript(({token,user})=>{localStorage.setItem('orbit_token',token);localStorage.setItem('orbit_user',JSON.stringify(user))},{token,user});
    const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${process.env.WEB_ORIGIN||'http://localhost:3000'}/board/${board}`);
    await page.getByText('Executable browser card',{exact:true}).click();
    const panel=page.getByRole('region',{name:'Capacidades do cartão'});
    await panel.waitFor();assert.equal(await panel.locator('details[open]').count(),0);
    await panel.getByText('Execução opcional',{exact:true}).click();
    await panel.getByLabel('Habilitar execução neste cartão').check();
    await panel.getByText('Projeto: Execution browser fixture',{exact:false}).waitFor();
    assert.equal(await panel.getByLabel('Projeto',{exact:true}).count(),0);
    await panel.locator('summary').filter({hasText:'Integrações'}).click();
    await panel.getByRole('button',{name:'Adicionar integração'}).click();
    await panel.getByLabel('path',{exact:true}).fill('selected.txt');
    await panel.locator('summary').filter({hasText:'Automações'}).click();
    await panel.getByLabel('Mover após sucesso').selectOption(review);
    await panel.getByRole('button',{name:'Salvar capacidades'}).click();
    await panel.getByRole('button',{name:'Executar',exact:true}).click();
    await panel.locator('summary').filter({hasText:'Resultado · Concluído'}).waitFor({timeout:15000});
    await panel.locator('summary').filter({hasText:'Resultado'}).click();
    await panel.getByText('ORBIT_BROWSER_OK',{exact:true}).waitFor();
    assert.equal((await db.one('SELECT list_id FROM cards WHERE id=$1',[card]))?.list_id,review);
    await page.getByText('definido pela coluna Review',{exact:false}).waitFor();
    await panel.locator('summary').filter({hasText:'Histórico de execuções (1)'}).click();
    await panel.getByRole('button').filter({hasText:'plugin · Concluído'}).click();
    await panel.getByText(/Run .* etapa:/).waitFor();
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate<boolean>('document.documentElement.scrollWidth > window.innerWidth'),false);
    assert.deepEqual(errors,[]);await context.close();
  }finally{
    await browser.close();await db.query('DELETE FROM boards WHERE id=$1',[board]);
    if(project)await db.query('DELETE FROM ai_projects WHERE id=$1',[project]);
    await db.onModuleDestroy();await rm(root,{recursive:true,force:true});
  }
});
