import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chmod,mkdir,mkdtemp,readFile,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {captureFileScope,validateWriteScope} from './file-scope';

test('file scope catches shell writes, restores unauthorized code and preserves authorized work',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-scope-'));
  try{
    await mkdir(join(root,'frontend'));await mkdir(join(root,'docs'));
    await writeFile(join(root,'frontend/page.tsx'),'original layout');
    await writeFile(join(root,'docs/facts.md'),'before');
    const verify=await captureFileScope(root,['docs/facts.md']);
    await writeFile(join(root,'frontend/page.tsx'),'unexpected redesign');
    await writeFile(join(root,'frontend/invented.tsx'),'fake field UI');
    await writeFile(join(root,'docs/facts.md'),'verified facts');
    await assert.rejects(verify,/fora do escopo.*revertidas/);
    assert.equal(await readFile(join(root,'frontend/page.tsx'),'utf8'),'original layout');
    await assert.rejects(()=>stat(join(root,'frontend/invented.tsx')));
    assert.equal(await readFile(join(root,'docs/facts.md'),'utf8'),'verified facts');
  }finally{await rm(root,{recursive:true,force:true})}
});
test('scope restores deleted files with their executable permissions and ignores browser evidence',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-scope-'));
  try{
    await writeFile(join(root,'check.mjs'),'protected');await chmod(join(root,'check.mjs'),0o755);
    const verify=await captureFileScope(root,[]);
    await rm(join(root,'check.mjs'));
    await mkdir(join(root,'.orbit/validations/artifacts'),{recursive:true});
    await writeFile(join(root,'.orbit/validations/artifacts/report.json'),'real test report');
    await assert.rejects(verify,/check.mjs/);
    assert.equal((await stat(join(root,'check.mjs'))).mode&0o777,0o755);
    assert.equal(await readFile(join(root,'.orbit/validations/artifacts/report.json'),'utf8'),'real test report');
  }finally{await rm(root,{recursive:true,force:true})}
});
test('scope rejects traversal, secrets, dependencies and unsupported shapes',()=>{
  for(const scope of [['../outside'],['/etc/passwd'],['.env'],['node_modules/change.js'],['.git/config'],null])assert.throws(()=>validateWriteScope(scope),/Escopo de escrita inválido/);
  assert.deepEqual(validateWriteScope(['docs/result.md','docs/result.md']),['docs/result.md']);
});

test('scope rejects directory targets and restores replaced parent links without touching another project',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-scope-links-')),outside=await mkdtemp(join(tmpdir(),'orbit-other-project-'));
  try{
    await mkdir(join(root,'frontend'));await writeFile(join(root,'frontend/page.tsx'),'original layout');
    await writeFile(join(outside,'page.tsx'),'another project');
    await assert.rejects(()=>captureFileScope(root,['frontend']),/Escopo de escrita inválido/);
    const verify=await captureFileScope(root,[]);
    await rm(join(root,'frontend'),{recursive:true});await symlink(outside,join(root,'frontend'),'dir');
    await assert.rejects(()=>captureFileScope(root,['frontend/page.tsx']),/Escopo de escrita inválido/);
    await assert.rejects(verify,/fora do escopo.*revertidas/);
    assert.equal(await readFile(join(outside,'page.tsx'),'utf8'),'another project');
    assert.equal(await readFile(join(root,'frontend/page.tsx'),'utf8'),'original layout');
  }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true})}
});
