import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runProjectChecks,validateProjectChecks} from './project-checks';
import {CodexAiService} from '../codex-ai';

test('project checks fail on failed verification and do not run later checks',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-checks-'));
  try{
    await assert.rejects(()=>runProjectChecks(root,[['node','-e','console.error("failed types");process.exit(1)'],['node','-e','require("fs").writeFileSync("later","bad")']]),/obrigatória falhou.*failed types/);
    await assert.rejects(()=>readFile(join(root,'later')));
    await runProjectChecks(root,[['node','-e','require("fs").writeFileSync("proof","passed")']]);
    assert.equal(await readFile(join(root,'proof'),'utf8'),'passed');
  }finally{await rm(root,{recursive:true,force:true})}
});
test('project checks stop a nonresponsive command',async()=>{
  await assert.rejects(()=>runProjectChecks(tmpdir(),[['node','-e','setInterval(()=>{},1000)']],50),/obrigatória falhou/);
});
test('project check configuration uses argv, with no shell interpolation',()=>{
  for(const value of ['npm run check',[[]],[['npm\nrestart']],[['npm',42]],[['/bin/sh','-c','anything']]])assert.throws(()=>validateProjectChecks(value),/Verificações do projeto inválidas/);
  assert.deepEqual(validateProjectChecks(undefined),[]);
  assert.deepEqual(validateProjectChecks([['npm','run','check']]),[['npm','run','check']]);
});

test('an AI success cannot bypass mandatory checks or authorize validator writes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-ai-checks-'));
  try{
    const ai=new CodexAiService();
    (ai as unknown as {run:()=>Promise<string>}).run=async()=> 'AI claimed success';
    const execute=(checks:string[][])=>ai.execute('Task',root,'fixture','medium',undefined,undefined,undefined,undefined,'bypass',[],[],checks);
    await assert.rejects(()=>execute([['node','-e','process.exit(1)']]),/obrigatória falhou/);
    await assert.rejects(()=>execute([['node','-e','require("fs").writeFileSync("unexpected","bad")']]),/fora do escopo.*revertidas/);
    await assert.rejects(()=>readFile(join(root,'unexpected')));
  }finally{await rm(root,{recursive:true,force:true})}
});

test('failed verification or execution restores authorized changes and removes new source files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-ai-rollback-'));
  try{
    await writeFile(join(root,'page.tsx'),'original layout');
    for(const failInRun of [false,true]){
      const ai=new CodexAiService();
      (ai as unknown as {run:()=>Promise<string>}).run=async()=>{
        await writeFile(join(root,'page.tsx'),'invalid replacement');
        await writeFile(join(root,'added.tsx'),'invented fields');
        if(failInRun)throw new Error('Executor failed');
        return 'AI claimed success';
      };
      await assert.rejects(()=>ai.execute('Task',root,'fixture','medium',undefined,undefined,undefined,undefined,'bypass',[],['page.tsx','added.tsx'],[['node','-e','process.exit(1)']]),failInRun?/Executor failed/:/obrigatória falhou/);
      assert.equal(await readFile(join(root,'page.tsx'),'utf8'),'original layout');
      await assert.rejects(()=>readFile(join(root,'added.tsx')));
    }
  }finally{await rm(root,{recursive:true,force:true})}
});
