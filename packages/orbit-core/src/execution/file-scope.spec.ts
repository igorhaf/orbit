import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chmod,mkdir,mkdtemp,readFile,rm,stat,symlink,truncate,writeFile} from 'node:fs/promises';
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

test('monorepo scope skips designated operational data and every Next build while protecting source data and YAML',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-scope-monorepo-'));
  try{
    const operational=[
      '.orbit/cache/checks/cache.json','.orbit/local/deliveries/result.json','.orbit/sessions/run.json',
      'dev/app/.orbit/cache/compiler.json','prod/app/.orbit/local/metrics.json','safdoulas/app/.orbit/sessions/run.json',
      'suinda/app/.orbit/validations/artifacts/evidence.json','products/new-course/app/.orbit/cache/index.json',
      'dev/data/large.bin','prod/data/large.bin','safdoulas/data/large.bin','suinda/data/large.bin',
      'products/new-course/data/large.bin','control/state/large.bin','control/backups/large.bin','control/snapshots/large.bin',
      'dev/app/apps/web/.next-native-dev/large.bin','products/new-course/app/apps/web/.next-custom/large.bin',
    ];
    for(const path of operational){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),'operational');if(path.endsWith('large.bin'))await truncate(join(root,path),110*1024*1024)}
    const protectedFiles=['src/data/record.ts','dev/app/src/data/record.ts','control/src/data/config.ts','.orbit/orbit.yaml','.orbit/rules/coding.md','suinda/app/.orbit/orbit.yaml'];
    for(const path of protectedFiles){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),'protected source')}
    const verify=await captureFileScope(root,[]);
    for(const path of operational.filter(path=>!path.endsWith('large.bin')))await writeFile(join(root,path),'new runtime state');
    assert.deepEqual(await verify(),[]);
    for(const path of protectedFiles)await writeFile(join(root,path),'unauthorized code');
    await assert.rejects(verify,/fora do escopo.*revertidas/);
    for(const path of protectedFiles)assert.equal(await readFile(join(root,path),'utf8'),'protected source');
    assert.equal(await readFile(join(root,'.orbit/local/deliveries/result.json'),'utf8'),'new runtime state');
  }finally{await rm(root,{recursive:true,force:true})}
});

test('operational namespaces cannot expand write scope and unrelated data source paths stay available',()=>{
  for(const path of [
    '.orbit/cache/checks/evidence.json','.orbit/local/context.md','.orbit/sessions/session.json',
    'dev/app/.orbit/cache/index.json','suinda/app/.orbit/local/metrics.json','products/new-course/app/.orbit/sessions/session.json',
    'dev/data/config.ts','products/new-course/data/config.ts','control/state/config.ts','control/backups/copy.ts','control/snapshots/tree.ts',
    'apps/web/.next-native-dev/server.js',
  ])assert.throws(()=>validateWriteScope([path]),/Escopo de escrita inválido/);
  assert.deepEqual(validateWriteScope(['src/data/record.ts','.orbit/orbit.yaml','.orbit/rules/coding.md','dev/app/.orbit/orbit.yaml']),['src/data/record.ts','.orbit/orbit.yaml','.orbit/rules/coding.md','dev/app/.orbit/orbit.yaml']);
});

test('operational links are never followed while source replacement still restores another project safely',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orbit-scope-operational-links-')),outside=await mkdtemp(join(tmpdir(),'orbit-scope-external-'));
  try{
    await mkdir(join(root,'.orbit'),{recursive:true});await mkdir(join(root,'products/new-course/app/.orbit'),{recursive:true});await mkdir(join(root,'dev'),{recursive:true});
    await writeFile(join(outside,'secret.ts'),'another project');
    await symlink(outside,join(root,'.orbit/cache'),'dir');await symlink(outside,join(root,'products/new-course/app/.orbit/local'),'dir');await symlink(outside,join(root,'dev/data'),'dir');
    await mkdir(join(root,'src/data'),{recursive:true});await writeFile(join(root,'src/data/secret.ts'),'protected code');
    const verify=await captureFileScope(root,[]);
    await rm(join(root,'src/data'),{recursive:true});await symlink(outside,join(root,'src/data'),'dir');
    await assert.rejects(verify,/fora do escopo.*revertidas/);
    assert.equal(await readFile(join(outside,'secret.ts'),'utf8'),'another project');
    assert.equal(await readFile(join(root,'src/data/secret.ts'),'utf8'),'protected code');
  }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true})}
});
