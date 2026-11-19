import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../..',import.meta.url));

test('07B opt-in dynamic lexical search uses the actual two-queue fixture with fake DB, quotas and executors', {timeout:150000}, async t=>{
  const directory=mkdtempSync(join(tmpdir(),'orbit-compiler-workers-parent-')),home=join(directory,'home');
  mkdirSync(home,{mode:0o700});
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  // Deliberate allowlist: never inherit product DB URLs, PG settings, host flags,
  // real credentials or Codex authentication into the worker harness process.
  const env={PATH:'/usr/bin:/bin',HOME:home,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',TZ:'UTC',TSX_DISABLE_CACHE:'1',ORBIT_CONTEXT_BRIDGE_KNOWLEDGE_TEST_MODE:'1',ORBIT_CONTEXT_COMPILER_ENABLED:'1',CODEX_BIN:join(directory,'must-never-run')};
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--test','--test-reporter=tap',join(root,'tools/orbit/context-workers.test.mjs')],{cwd:root,env,stdio:['ignore','pipe','pipe'],timeout:140000,killSignal:'SIGTERM'});
    let stdout='',stderr='';
    child.stdout.on('data',chunk=>{stdout+=chunk});child.stderr.on('data',chunk=>{stderr+=chunk});
    child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
  });
  assert.equal(result.code,0,result.stdout+'\n'+result.stderr);
  const counts=Object.fromEntries([...result.stdout.matchAll(/^# (tests|pass|fail|skipped) (\d+)$/gm)].map(match=>[match[1],Number(match[2])]));
  assert.ok(counts.tests>=14,'the subprocess must execute the extended compiler fixture');
  assert.equal(counts.pass,counts.tests);assert.equal(counts.fail,0);assert.equal(counts.skipped,0);
  assert.equal(existsSync(join(home,'.codex')),false);
  t.diagnostic(`Child fixture: ${counts.pass}/${counts.tests} passed, ${counts.fail} failed, ${counts.skipped} skipped. Count these child scenarios once; this wrapper is only orchestration.`);
});
