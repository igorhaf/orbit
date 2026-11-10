import pg from 'pg';
import jwt from 'jsonwebtoken';
import assert from 'node:assert/strict';
import {pluginNavigation} from '../apps/web/lib/plugin-navigation.ts';
const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{
 const {rows:[root]}=await db.query('SELECT id,session_version FROM users WHERE is_root AND NOT disabled LIMIT 1');
 const token=jwt.sign({sub:root.id,version:root.session_version},process.env.JWT_SECRET,{expiresIn:'5m'});
 const response=await fetch('http://127.0.0.1:4003/plugins',{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,200);const catalog=await response.json();const navigation=pluginNavigation(catalog.plugins,()=>true);
 const menu=navigation.menus.find(menu=>menu.id==='accreditation');assert.ok(menu);
 assert.equal(menu.sections.length,4);assert.equal(menu.sections.flatMap(s=>s.links).length,13);
 assert.deepEqual(menu.sections.map(s=>s.id),['overview','registry','workflow','publication']);
 assert.equal(navigation.standalone.filter(item=>item.href.includes('safdoulas')).length,0);
 assert.equal(menu.sections[0].links[0].href,'/safdoulas/processes');
 const before=catalog.plugins.map(plugin=>({...plugin,enabled:plugin.id.startsWith('safdoulas-')?false:plugin.enabled}));
 assert.equal(pluginNavigation(before,()=>true).menus.some(menu=>menu.id==='accreditation'),false);
 const denied=pluginNavigation(catalog.plugins,()=>false);assert.equal(denied.menus.some(menu=>menu.id==='accreditation'),false);
 console.log('Catálogo real validado: 13 links em um menu de 4 seções; ordem, RBAC e remoção do grupo sem contribuições válidas verificados.');
}finally{await db.end()}
