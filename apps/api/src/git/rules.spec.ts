import assert from 'node:assert/strict';
import {test} from 'node:test';
import {allowedBranch,branches,conventionalMessage,gitPaths} from './rules';

test('versioning works with repository branches without a deploy target',()=>{
  assert.equal(allowedBranch('develop',branches(['develop','main'])),'develop');
  assert.throws(()=>allowedBranch('other',['develop','main']),/não está configurada/);
  assert.throws(()=>allowedBranch('main',['main'],['develop']),/não está configurada/);
});
test('commit message follows Conventional Commits and has at most two body lines',()=>{
  const message=conventionalMessage('feat','Adicionar fluxo',['src/a.ts','src/b.ts'],'2 files changed, 10 insertions');
  assert.match(message.subject,/^feat: /);
  assert.equal(message.body.split('\n').length,2);
  assert.throws(()=>conventionalMessage('other','x',['a'],'1 file'),/Tipo/);
});
test('file paths reject option injection and traversal',()=>{
  assert.deepEqual(gitPaths(['src/a.ts','src/a.ts']),['src/a.ts']);
  for(const path of ['--all','../secret','/etc/passwd','.git/config','.env',':(top)secret','src/*','a\\b'])assert.throws(()=>gitPaths([path]));
});
