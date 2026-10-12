import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {ChildProcess} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defaults,parseConfiguration,validateOrigin,ProcessIdentity} from './configuration';
import {CloudflaredAdapter,parseVersion,ProcessAdapter} from './cloudflared-adapter';
import {CloudflaredProcessManager} from './process-manager';
import {redact} from './redaction';
import {CloudflareTunnelPlugin} from './cloudflare-tunnel.plugin';
import type {Db} from '../db';
import type {SecretVault} from '../secrets';
const secret='canary-private-token-ABC123';
class Fake implements ProcessAdapter {
 installed=true; valid=true; live=false; externalPid:number|null=null; online=false; launches=0; stops=0; fail=false;
 child!:ChildProcess;
 identity:ProcessIdentity={pid:123,executable:'/bin/cloudflared',startTicks:'12345',marker:'00000000-0000-4000-8000-000000000000',metricsPort:12345,startedAt:new Date().toISOString()};
 async detect(){return {installed:this.installed,path:this.installed?'/bin/cloudflared':null,version:this.installed?'2026.1.0':null};}
 async validate(config:typeof defaults,token:string){if(!this.installed)throw new Error('cloudflared ausente');if(!this.valid||(config.mode==='remote'&&!token))throw new Error('Token ausente');}
 async launch(){this.launches++;if(this.fail)throw new Error(`spawn token=${secret}`);this.live=true;this.identity={...this.identity,marker:`00000000-0000-4000-8000-${String(this.launches).padStart(12,'0')}`};this.child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null}) as unknown as ChildProcess;return {process:this.child,identity:this.identity};}
 async matches(value:ProcessIdentity){return this.live&&value.marker===this.identity.marker&&value.startTicks===this.identity.startTicks;}
 async stop(){this.stops++;this.live=false;}
 async external(){return this.externalPid;}
 async ready(){return this.online;}
 crash(){this.live=false;this.child.emit('exit',1);}
}
const config=(values:Partial<typeof defaults>={})=>({...defaults,restartOnFailure:false,...values});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('configuration rejects unknown fields, unsafe origins and quick autostart',()=>{
 assert.throws(()=>parseConfiguration({invented:true}));assert.throws(()=>parseConfiguration({mode:'quick',autoStart:true}));
 assert.throws(()=>parseConfiguration({maxRestartAttempts:999}));assert.throws(()=>parseConfiguration({executablePath:'relative'}));
 for(const value of ['http://localhost:99999','http://localhost:0','ftp://localhost','http://user:pass@localhost','http://localhost/?token=x'])assert.throws(()=>validateOrigin(value));
 assert.equal(parseConfiguration({}).autoStart,false);assert.equal(validateOrigin('http://localhost:4000'),'http://localhost:4000/');
});
test('version and binary detection execute without a shell and tolerate missing binary',async()=>{
 assert.equal(parseVersion('cloudflared version 2026.1.2 (built now)'),'2026.1.2');assert.equal(parseVersion('other binary'),null);
 const calls:string[][]=[];const adapter=new CloudflaredAdapter(async(_binary,args,options)=>{assert.equal(options.shell,false);calls.push(args);return {stdout:'cloudflared version 2026.1.2',stderr:''};});
 assert.equal((await adapter.detect('/bin/sh')).installed,true);assert.deepEqual(calls,[['version']]);assert.equal((await adapter.detect('/missing/cloudflared')).installed,false);
});
test('local YAML and credentials validation calls ingress validate, rejects TLS bypass and missing files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'orbit-tunnel-'));const uuid='00000000-0000-4000-8000-000000000000';const file=join(dir,'config.yml');
 try{
 await writeFile(join(dir,'credentials.json'),JSON.stringify({TunnelID:uuid,TunnelSecret:'local-secret',AccountTag:'account'}));
 const yaml=`tunnel: ${uuid}\ncredentials-file: credentials.json\ningress:\n  - service: http://localhost:4000\n  - service: http_status:404\n`;
 await writeFile(file,yaml);let commands=0;const adapter=new CloudflaredAdapter(async(_binary,args)=>{assert.deepEqual(args,['tunnel','--config',file,'ingress','validate']);commands++;return {stdout:'',stderr:''};});
 const detection={installed:true,path:'/bin/cloudflared',version:'2026.1.0'};
 await adapter.validate(config({mode:'local',configPath:file}),'',detection);assert.equal(commands,1);
 await writeFile(file,yaml+'originRequest:\n  noTLSVerify: true\n');await assert.rejects(adapter.validate(config({mode:'local',configPath:file}),'',detection),/TLS/);
 await assert.rejects(adapter.validate(config({mode:'local',configPath:join(dir,'missing')}),'',detection),/ausente/);
 await assert.rejects(adapter.validate(config(),' ',detection),/Token/);
 await adapter.validate(config({mode:'quick'}),'',detection);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('disabled, missing and incomplete installations isolate failures without launching',async()=>{
 for(const scenario of ['disabled','missing','incomplete']){
 const fake=new Fake();fake.installed=scenario!=='missing';const manager=new CloudflaredProcessManager(fake);
 await manager.initialize(scenario!=='disabled',config(),scenario==='incomplete'?'':secret,null);
 assert.equal(manager.snapshot().state,scenario==='disabled'?'DISABLED':scenario==='missing'?'NOT_INSTALLED':'NOT_CONFIGURED');assert.equal(fake.launches,0);await manager.shutdown();
 }
});
test('start, connected/degraded status, restart and stop control only owned processes',async()=>{
 const fake=new Fake();const persisted:Array<ProcessIdentity|null>=[];const manager=new CloudflaredProcessManager(fake,async value=>{persisted.push(value);});
 await manager.initialize(true,config(),secret,null);assert.equal(manager.snapshot().state,'STOPPED');
 await manager.start();await manager.start();assert.equal(fake.launches,1);assert.equal(manager.snapshot().state,'STARTING');
 fake.child.stderr!.emit('data','Registered tunnel connection connIndex=0\n');assert.equal(manager.snapshot().state,'CONNECTED');
 fake.online=false;await manager.tick();assert.equal(manager.snapshot().state,'DEGRADED');fake.online=true;await manager.tick();assert.equal(manager.snapshot().health.status,'healthy');
 const old=fake.child;await manager.restart();assert.equal(fake.launches,2);assert.equal(fake.stops,1);
 old.stderr!.emit('data','Registered tunnel connection connIndex=0\n');assert.equal(manager.snapshot().state,'STARTING');
 await manager.stop();assert.equal(manager.snapshot().state,'STOPPED');assert.equal(fake.stops,2);assert.equal(persisted.at(-1),null);await manager.shutdown();
});
test('external observer never starts, stops or adopts external processes',async()=>{
 const fake=new Fake();fake.externalPid=555;const manager=new CloudflaredProcessManager(fake);
 await manager.initialize(true,config({managedBy:'system',autoStart:true}),secret,null);assert.equal(manager.snapshot().pid,555);
 await assert.rejects(manager.start(),/apenas observa/);await assert.rejects(manager.stop(),/apenas observa/);await manager.shutdown();assert.equal(fake.stops,0);assert.equal(fake.launches,0);
 const owned=new CloudflaredProcessManager(fake);await owned.initialize(true,config(),secret,null);await assert.rejects(owned.start(),/externo/);assert.equal(fake.launches,0);await owned.shutdown();
});
test('recovery verifies full identity and does not duplicate or signal reused PID',async()=>{
 const fake=new Fake();fake.live=true;const manager=new CloudflaredProcessManager(fake);
 await manager.initialize(true,config({autoStart:true}),secret,fake.identity);assert.equal(manager.snapshot().recovered,true);assert.equal(manager.snapshot().state,'STARTING');assert.equal(fake.launches,0);
 fake.identity={...fake.identity,startTicks:'different'};await manager.stop();assert.equal(fake.stops,0);await manager.shutdown();
});
test('autostart and disabling perform graceful shutdown',async()=>{
 const fake=new Fake();const manager=new CloudflaredProcessManager(fake);await manager.initialize(true,config({autoStart:true}),secret,null);assert.equal(fake.launches,1);
 await manager.setEnabled(false);assert.equal(fake.stops,1);assert.equal(manager.snapshot().state,'DISABLED');await manager.shutdown();
});
test('bounded automatic retries stop at the configured limit and redact launch errors',async()=>{
 const fake=new Fake();fake.fail=true;const manager=new CloudflaredProcessManager(fake);
 await manager.initialize(true,config({autoStart:true,restartOnFailure:true,restartDelaySeconds:1,maxRestartAttempts:1}),secret,null);
 await new Promise(resolve=>setTimeout(resolve,1150));await manager.tick();assert.equal(fake.launches,2);assert.equal(manager.snapshot().state,'ERROR');assert.equal(manager.snapshot().restartCount,1);assert.ok(!JSON.stringify(manager.snapshot()).includes(secret));await manager.shutdown();
});
test('unexpected exit is isolated and stop cancels retry',async()=>{
 const fake=new Fake();const manager=new CloudflaredProcessManager(fake);await manager.initialize(true,config({restartOnFailure:true}),secret,null);await manager.start();fake.crash();await settle();await manager.tick();assert.equal(manager.snapshot().state,'DEGRADED');await manager.stop();await manager.shutdown();assert.equal(fake.launches,1);
});
test('split logs redact tokens, credentials and auth while enforcing retention',async()=>{
 const fake=new Fake();const manager=new CloudflaredProcessManager(fake);await manager.initialize(true,config({logLimit:50,mode:'quick'}),secret,null);await manager.start();
 fake.child.stdout!.emit('data',secret.slice(0,10));fake.child.stdout!.emit('data',secret.slice(10)+'\n');
 fake.child.stderr!.emit('data','Temporary URL https://example.trycloudflare.com\n');assert.equal(manager.snapshot().temporaryUrl,'https://example.trycloudflare.com');
 for(let n=0;n<75;n++)fake.child.stdout!.emit('data',`TUNNEL_TOKEN=${secret} Authorization: Bearer PRIVATE\n`);
 assert.equal(manager.snapshot().logs.length,50);const output=JSON.stringify(manager.snapshot());assert.ok(!output.includes(secret));assert.ok(!output.includes('PRIVATE'));await manager.shutdown();
 const safe=redact('TunnelSecret=abc AccountTag=def https://user:pass@host/path?api_key=key&token=xyz#private');for(const sensitive of ['abc','def','user','pass','xyz','private'])assert.ok(!safe.includes(sensitive));
});
test('plugin lifecycle resolves even when persistence is unavailable',async()=>{
 const plugin=new CloudflareTunnelPlugin({one:async()=>{throw new Error('database unavailable');}} as unknown as Db,{} as SecretVault);
 await plugin.onModuleInit();await plugin.onModuleDestroy();
});
test('stored token uses SecretVault and is never returned by configuration, save or status',async()=>{
 const {SecretVault:Vault}=await import('../secrets');const previous=process.env.ORBIT_SECRET_KEY;process.env.ORBIT_SECRET_KEY='unit-test-key-only';
 let row:{id:string;owner_id:string;credentials_encrypted:string;metadata:unknown}|null=null;
 const client=Object.assign(new EventEmitter(),{query:async()=>({rows:[{locked:true}]}),release:()=>{}});
 const db={pool:{connect:async()=>client},one:async(sql:string,params:unknown[])=>{if(sql.startsWith('SELECT enabled'))return null;if(sql.startsWith('SELECT id'))return row;if(sql.startsWith('INSERT')){row={id:'connection',owner_id:String(params[0]),credentials_encrypted:String(params[2]),metadata:JSON.parse(String(params[3]))};return row;}throw new Error('Unexpected query');}};
 const vault=new Vault();const plugin=new CloudflareTunnelPlugin(db as unknown as Db,vault);
 try{
 const saved=await plugin.save('owner',{configuration:config(),token:secret});const stored=row as {credentials_encrypted:string}|null;assert.ok(stored);assert.ok(!stored.credentials_encrypted.includes(secret));assert.deepEqual(vault.open(stored.credentials_encrypted),{token:secret});
 for(const value of [saved,await plugin.configuration('owner'),await plugin.status('owner')])assert.ok(!JSON.stringify(value).includes(secret));
 await assert.rejects(plugin.configuration('other'),/administrador/);await plugin.save('owner',{configuration:config()});assert.equal((await plugin.configuration('owner')).tokenConfigured,true);
 await plugin.save('owner',{configuration:config(),removeToken:true});assert.equal((await plugin.configuration('owner')).tokenConfigured,false);assert.equal(client.listenerCount('error'),0);
 }finally{await plugin.onModuleDestroy();if(previous===undefined)delete process.env.ORBIT_SECRET_KEY;else process.env.ORBIT_SECRET_KEY=previous;}
});
test('isolated Nest application starts without plugin and with every optional tunnel state',async()=>{
 const {Module}=await import('@nestjs/common');const {NestFactory}=await import('@nestjs/core');
 for(const scenario of ['absent','disabled','missing','incomplete','stopped','offline','connected']){
 const fake=new Fake();fake.installed=scenario!=='missing';fake.online=scenario==='connected';
 const manager=new CloudflaredProcessManager(fake);
 const client=Object.assign(new EventEmitter(),{query:async()=>({rows:[{locked:true}]}),release:()=>{}});
 const db={one:async(sql:string)=>sql.startsWith('SELECT enabled')?{enabled:scenario!=='disabled'}:{id:'local',owner_id:'owner',credentials_encrypted:'sealed',metadata:{configuration:config({autoStart:['offline','connected'].includes(scenario)}),runtime:null}},pool:{connect:async()=>client},query:async()=>[{id:'local'}]};
 const plugin=new CloudflareTunnelPlugin(db as unknown as Db,{open:()=>({token:scenario==='incomplete'?'':secret})} as unknown as SecretVault);
 // Use the real plugin lifecycle and persistence contract with mocked OS and database boundaries.
 Object.assign(plugin,{manager});
 class FixtureModule{}
 Module({providers:scenario==='absent'?[]:[{provide:CloudflareTunnelPlugin,useValue:plugin}]})(FixtureModule);
 const app=await NestFactory.create(FixtureModule,{logger:false});
 try{await app.listen(0,'127.0.0.1');assert.ok(app.getHttpServer().address());if(scenario==='connected'){await manager.tick();assert.equal(manager.snapshot().state,'CONNECTED');}if(scenario==='missing')assert.equal(manager.snapshot().state,'NOT_INSTALLED');}
 finally{await app.close();}
 }
});

test('redaction covers quoted JSON values and sensitive environment variables',()=>{
 for(const input of ['{"TunnelSecret":"long private secret value"}', "PASSWORD='long private secret value'", 'API_KEY=private-value', 'Authorization: Bearer private-value', 'https://host/?signature=private-value']){const safe=redact(input);assert.ok(!safe.includes('private'));assert.ok(!safe.includes('secret value'));}
 assert.throws(()=>parseConfiguration({constructor:'invented'}));
});

test('changing configuration cancels a pending automatic restart',async()=>{
 const fake=new Fake();fake.fail=true;const manager=new CloudflaredProcessManager(fake);
 await manager.initialize(true,config({autoStart:true,restartOnFailure:true,restartDelaySeconds:1}),secret,null);
 await manager.initialize(true,config({autoStart:false}),secret,null);
 await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(fake.launches,1);assert.equal(manager.snapshot().state,'STOPPED');await manager.shutdown();
});

test('system ownership never adopts even a previously valid saved identity',async()=>{
 const fake=new Fake();fake.live=true;fake.externalPid=fake.identity.pid;const manager=new CloudflaredProcessManager(fake);await manager.initialize(true,config({managedBy:'system'}),secret,fake.identity);assert.equal(manager.isRunning(),false);assert.equal(manager.snapshot().recovered,false);await manager.shutdown();assert.equal(fake.stops,0);
});

test('tunnel identity and hostname are saved as reference without accepting URLs or invalid UUIDs',()=>{
 const identity={tunnelName:'Orbit Dev',tunnelId:'204a6bd0-1b1e-408c-a01f-b04359867c6e',publicHostname:'orbit.meadadigital.com'};assert.equal(parseConfiguration(identity).publicHostname,identity.publicHostname);assert.throws(()=>parseConfiguration({publicHostname:'https://orbit.meadadigital.com'}));assert.throws(()=>parseConfiguration({tunnelId:'invalid'}));assert.throws(()=>parseConfiguration({publicHostname:'bad-.example.com'}));
});
