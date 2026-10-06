import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Pool} from 'pg';
import {Db} from '../db';
import {SecretVault} from '../secrets';
import {StepHandlerRegistry} from './contracts';
import {DeliveryCredentialService,CommandExecutorRegistry,LocalCommandExecutor,SshCommandExecutor} from './executors';
import {DeliveryGitService} from './git-service';
import {DeliveryHandlers,DeploymentStrategyRegistry,PromotionStrategyRegistry} from './handlers';
import {DeliveryManagement} from './management';
import {DeliveryRunner} from './runner';

const exec=promisify(execFile);
const git=async(cwd:string,...args:string[])=>{const output=await exec('git',args,{cwd,timeout:10000});return output.stdout.trim()};
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

test('delivery runs full Git → deploy → test → approval → promotion flow and selective bypass',async()=>{
  if(!process.env.DATABASE_URL)return;
  const schema='delivery_test_'+randomUUID().replaceAll('-',''),root=await mkdtemp(join(tmpdir(),'orbit-delivery-test-')),db=new Db();
  await db.query(`CREATE SCHEMA ${schema}`);await db.pool.end();db.pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
  try{
    await db.query(await readFile(resolve(__dirname,'../../sql/schema.sql'),'utf8'));
    const source=join(root,'source'),bare=join(root,'remote.git');await mkdir(source);await git(root,'init','--bare',bare);await git(source,'init','-b','develop');await git(source,'config','user.email','delivery@example.invalid');await git(source,'config','user.name','Delivery Test');await writeFile(join(source,'change.txt'),'initial\n');await git(source,'add','change.txt');await git(source,'commit','-m','chore: initial');await git(source,'remote','add','customer',bare);
    for(const branch of ['develop','staging','main']){if(branch!=='develop')await git(source,'branch',branch);await git(source,'push','customer',branch)}
    await git(root,'--git-dir',bare,'symbolic-ref','HEAD','refs/heads/develop');
    const paths:Record<string,string>={development:join(root,'development'),staging:join(root,'staging'),production:join(root,'production')};
    for(const [environment,path] of Object.entries(paths)){await git(root,'clone','-o','customer',bare,path);await git(path,'switch',environment==='development'?'develop':environment==='staging'?'staging':'main')}
    const owner=(await db.one<{id:string}>('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id',['Delivery Owner',`${randomUUID()}@example.invalid`,'test']))!.id;
    const project=(await db.one<{id:string}>('INSERT INTO ai_projects(owner_id,name,local_path) VALUES($1,$2,$3) RETURNING id',[owner,'Delivery Project',root]))!.id;
    const repository=(await db.one<{id:string}>('INSERT INTO git_repositories(owner_id,project_id,name,relative_path,remote_name,branches) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[owner,project,'Source','source','customer',['develop','staging','main']]))!.id;
    const remote=(await db.one<{id:string}>('INSERT INTO delivery_git_remotes(repository_id,name,url,default_branch) VALUES($1,$2,$3,$4) RETURNING id',[repository,'customer',bare,'develop']))!.id;
    const targetIds:Record<string,string>={};const environmentIds:Record<string,string>={};
    for(const [environment,path] of Object.entries(paths)){
      const env=(await db.one<{id:string}>('INSERT INTO delivery_environments(project_id,name,slug) VALUES($1,$2,$3) RETURNING id',[project,environment,environment]))!.id;environmentIds[environment]=env;
      targetIds[environment]=(await db.one<{id:string}>('INSERT INTO delivery_targets(project_id,environment_id,name,executor_type,repository_id,working_directory,git_remote_id,git_branch,build_commands,restart_command) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING id',[project,env,environment,'local',repository,path,remote,environment==='development'?'develop':environment==='staging'?'staging':'main',JSON.stringify(['test -f change.txt']),'true']))!.id;
    }
    const pipeline=(await db.one<{id:string}>('INSERT INTO delivery_pipelines(owner_id,project_id,name,trigger_type,enabled) VALUES($1,$2,$3,$4,true) RETURNING id',[owner,project,'Delivery Default','manual']))!.id;
    const plans:Array<{type:string;name:string;config:Record<string,unknown>;bypass?:string}>=[];
    const add=(type:string,name:string,config:Record<string,unknown>,bypass='deny')=>plans.push({type,name,config,bypass});
    add('git.add','Git Add',{repositoryId:repository,paths:['change.txt'],workingDirectory:source});
    add('git.commit','Git Commit',{repositoryId:repository,message:'feat: deliver feature\nupdate files\nprepare delivery',workingDirectory:source});
    add('git.push','Git Push',{repositoryId:repository,remoteId:remote,branch:'develop',workingDirectory:source});
    const deploy=(environment:string)=>add('deploy.execute',`Deploy ${environment}`,{strategy:'git',environmentId:environmentIds[environment],deployTargetId:targetIds[environment]});
    const check=(environment:string)=>add('test.run',`Test ${environment}`,{command:'test -f change.txt',executor:'local',workingDirectory:paths[environment]},'allow');
    const approval=(message:string)=>add('approval.wait',message,{message},'allow');
    const promote=(sourceBranch:string,targetBranch:string)=>add('promotion.execute',`Promote ${targetBranch}`,{strategy:'git.merge',repositoryId:repository,remoteId:remote,source:sourceBranch,target:targetBranch,executor:'local',workingDirectory:source});
    deploy('development');check('development');approval('Promote to Staging?');promote('develop','staging');deploy('staging');check('staging');approval('Promote to Production?');promote('staging','main');deploy('production');check('production');
    for(const [position,plan] of plans.entries())await db.query('INSERT INTO delivery_steps(pipeline_id,type,name,config,position,bypass_policy) VALUES($1,$2,$3,$4::jsonb,$5,$6)',[pipeline,plan.type,plan.name,JSON.stringify(plan.config),position,plan.bypass]);
    const vault=new SecretVault(),credentials=new DeliveryCredentialService(db,vault),ssh=new SshCommandExecutor(db,credentials),executors=new CommandExecutorRegistry();executors.register(new LocalCommandExecutor());executors.register(ssh);const gitService=new DeliveryGitService(db,executors,credentials),handlers=new DeliveryHandlers(db,executors,gitService),stepRegistry=new StepHandlerRegistry(),deployments=new DeploymentStrategyRegistry(),promotions=new PromotionStrategyRegistry();handlers.register(stepRegistry,deployments,promotions);const management=new DeliveryManagement(db,stepRegistry,credentials,ssh),runner=new DeliveryRunner(db,management,stepRegistry,deployments,promotions,gitService,ssh,credentials);
    const wait=async(runId:string,status:string)=>{for(let i=0;i<300;i++){const row=await db.one<{status:string;error:string|null}>('SELECT status,error FROM delivery_runs WHERE id=$1',[runId]);if(row?.status===status)return;if(['failed','rejected'].includes(row?.status||''))throw new Error(`Run ${row?.status}: ${row?.error}`);await pause(20)}throw new Error(`Timeout waiting for ${status}`)};
    await writeFile(join(source,'change.txt'),'normal delivery\n');
    const normal=await runner.start(owner,pipeline,{mode:'normal'});await wait(normal.id,'waiting_approval');
    assert.equal((await db.one<{count:string}>("SELECT count(*) FROM delivery_step_runs WHERE run_id=$1 AND status='success'",[normal.id]))!.count,'5');
    await runner.decision(owner,normal.id,true,'Validated DEV');await wait(normal.id,'waiting_approval');
    await runner.decision(owner,normal.id,true,'Validated STAGING');await wait(normal.id,'success');
    assert.equal((await db.one<{count:string}>("SELECT count(*) FROM delivery_step_runs WHERE run_id=$1 AND status='success'",[normal.id]))!.count,'13');
    assert.equal((await git(paths.production,'log','-1','--format=%s')),'feat: deliver feature');
    assert.equal((await db.one<{count:string}>('SELECT count(*) FROM delivery_approvals WHERE run_id=$1 AND approved_at IS NOT NULL',[normal.id]))!.count,'2');
    await git(source,'switch','develop');await writeFile(join(source,'change.txt'),'bypass delivery\n');
    await assert.rejects(()=>runner.start(owner,pipeline,{mode:'bypass',reason:'E2E bypass validation',bypassOptions:{tests:true,approvals:true}}),/pipeline.bypass/);
    await management.setBypass(owner,true);
    const bypass=await runner.start(owner,pipeline,{mode:'bypass',reason:'E2E bypass validation',bypassOptions:{tests:true,approvals:true}});await wait(bypass.id,'success');
    assert.equal((await db.one<{count:string}>("SELECT count(*) FROM delivery_step_runs WHERE run_id=$1 AND status='bypassed'",[bypass.id]))!.count,'5');
    assert.equal((await db.one<{count:string}>('SELECT count(*) FROM delivery_approvals WHERE run_id=$1',[bypass.id]))!.count,'0');
    assert.equal((await db.one<{count:string}>("SELECT count(*) FROM delivery_audit WHERE run_id=$1 AND event='step.bypassed'",[bypass.id]))!.count,'5');
    const detail=await runner.detail(owner,bypass.id);assert.equal(detail.bypass_reason,'E2E bypass validation');assert.equal(detail.mode,'bypass');
    assert.equal((await git(paths.production,'log','-1','--format=%s')),'feat: deliver feature');
    await git(source,'switch','develop');await writeFile(join(source,'change.txt'),'full bypass delivery\n');
    const fullBypass=await runner.start(owner,pipeline,{mode:'bypass',reason:'E2E full bypass validation',bypassOptions:{allWorkflowPolicies:true}});await wait(fullBypass.id,'success');
    assert.equal((await db.one<{count:string}>("SELECT count(*) FROM delivery_step_runs WHERE run_id=$1 AND status='bypassed'",[fullBypass.id]))!.count,'5');
    const supplemental=(await db.one<{id:string}>('INSERT INTO delivery_pipelines(owner_id,project_id,name,enabled) VALUES($1,$2,$3,true) RETURNING id',[owner,project,'Delivery policy checks']))!.id;
    const addStep=async(type:string,config:Record<string,unknown>,position:number,policy='stop',extra:Record<string,unknown>={})=>db.one<{id:string}>('INSERT INTO delivery_steps(pipeline_id,type,name,config,position,failure_policy,max_attempts,requires,bypass_policy) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) RETURNING id',[supplemental,type,type,JSON.stringify(config),position,policy,extra.maxAttempts??1,extra.requires??[],extra.bypassPolicy??'deny']);
    const approvalStep=await addStep('approval.wait',{message:'Reject this run',allowedUserIds:[owner]},0);
    await addStep('command.execute',{command:'touch should-not-exist',executor:'local',workingDirectory:root},1);
    const rejected=await runner.start(owner,supplemental,{mode:'normal'});await wait(rejected.id,'waiting_approval');
    const stranger=(await db.one<{id:string}>('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id',['Stranger',`${randomUUID()}@example.invalid`,'test']))!.id;
    await assert.rejects(()=>runner.decision(stranger,rejected.id,true,''),/Aprovação indisponível/);
    await runner.decision(owner,rejected.id,false,'Rejected for validation');assert.equal((await db.one<{status:string}>('SELECT status FROM delivery_runs WHERE id=$1',[rejected.id]))!.status,'rejected');
    assert.equal((await db.one<{status:string}>('SELECT status FROM delivery_step_runs WHERE run_id=$1 AND step_id=$2',[rejected.id,approvalStep!.id]))!.status,'rejected');
    assert.equal((await db.one<{count:string}>("SELECT count(*) FROM delivery_audit WHERE run_id=$1 AND event='approval.rejected'",[rejected.id]))!.count,'1');
    await assert.rejects(()=>readFile(join(root,'should-not-exist')),/ENOENT/);
    await db.query('DELETE FROM delivery_steps WHERE pipeline_id=$1',[supplemental]);
    await addStep('command.execute',{command:'exit 7',executor:'local',workingDirectory:root},0,'continue');
    await addStep('command.execute',{command:'if [ ! -f retry.marker ]; then touch retry.marker; exit 7; fi; echo retry-ok',executor:'local',workingDirectory:root},1,'retry',{maxAttempts:2});
    const recovered=await runner.start(owner,supplemental,{mode:'normal'});await wait(recovered.id,'success');
    const stepRuns=await db.query<{status:string;attempt:number;stdout:string}>('SELECT status,attempt,stdout FROM delivery_step_runs WHERE run_id=$1 ORDER BY (step_snapshot->>\'position\')::int',[recovered.id]);
    assert.deepEqual(stepRuns.map(item=>item.status),['failed','success']);assert.equal(stepRuns[1].attempt,2);assert.match(stepRuns[1].stdout,/retry-ok/);
    await db.query('DELETE FROM delivery_steps WHERE pipeline_id=$1',[supplemental]);
    await addStep('deploy.execute',{strategy:'git',environmentId:environmentIds.development,deployTargetId:targetIds.development},0);
    await db.query('INSERT INTO delivery_target_locks(target_id,run_id) VALUES($1,$2)',[targetIds.development,normal.id]);
    const locked=await runner.start(owner,supplemental,{mode:'normal'});for(let i=0;i<300;i++){const status=(await db.one<{status:string}>('SELECT status FROM delivery_runs WHERE id=$1',[locked.id]))!.status;if(status==='failed')break;await pause(20)}
    assert.match((await db.one<{error:string}>('SELECT error FROM delivery_runs WHERE id=$1',[locked.id]))!.error,/ocupado/);
    await db.query('DELETE FROM delivery_target_locks WHERE target_id=$1',[targetIds.development]);
    await db.query('DELETE FROM delivery_steps WHERE pipeline_id=$1',[supplemental]);
    const producer=await addStep('test.run',{command:'true',executor:'local',workingDirectory:root},0,'stop',{bypassPolicy:'allow'});
    await addStep('command.execute',{command:'true',executor:'local',workingDirectory:root},1,'stop',{requires:[`steps.${producer!.id}.exitCode`]});
    await assert.rejects(()=>runner.start(owner,supplemental,{mode:'bypass',reason:'Dependency validation',bypassOptions:{tests:true}}),/Bypass remove output obrigatório/);
    assert.equal((await db.one<{count:string}>('SELECT count(*) FROM delivery_runs WHERE pipeline_id=$1',[supplemental]))!.count,'3');
    await db.query('DELETE FROM delivery_steps WHERE pipeline_id=$1',[supplemental]);
    const oldVaultKey=process.env.ORBIT_SECRET_KEY,oldFixture=process.env.ORBIT_DELIVERY_TEST_SECRET;
    try{
      process.env.ORBIT_SECRET_KEY=oldVaultKey||'integration-only-vault-key';process.env.ORBIT_DELIVERY_TEST_SECRET='delivery-redaction-fixture-74f0c3';
      await credentials.create(owner,{name:'fixture secret',kind:'GIT_TOKEN',value:process.env.ORBIT_DELIVERY_TEST_SECRET});
      await addStep('command.execute',{command:'printf %s "$ORBIT_DELIVERY_TEST_SECRET"',executor:'local',workingDirectory:root},0);
      const secretRun=await runner.start(owner,supplemental,{mode:'normal'});await wait(secretRun.id,'success');
      assert.doesNotMatch(JSON.stringify(await runner.detail(owner,secretRun.id)),/delivery-redaction-fixture-74f0c3/);
      assert.equal((await credentials.list(owner) as Array<Record<string,unknown>>).some(item=>'encrypted_value' in item),false);
    }finally{
      if(oldVaultKey===undefined)delete process.env.ORBIT_SECRET_KEY;else process.env.ORBIT_SECRET_KEY=oldVaultKey;
      if(oldFixture===undefined)delete process.env.ORBIT_DELIVERY_TEST_SECRET;else process.env.ORBIT_DELIVERY_TEST_SECRET=oldFixture;
    }
  }finally{await db.pool.end();const cleanup=new Pool({connectionString:process.env.DATABASE_URL});try{await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)}finally{await cleanup.end()}await rm(root,{recursive:true,force:true})}
});
