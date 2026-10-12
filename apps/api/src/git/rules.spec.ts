import assert from 'node:assert/strict';
import {test} from 'node:test';
import {allowedBranch,branches,commitDescription,commitSuggestion,conventionalMessage,gitPaths,validCommitType} from './rules';

test('versioning works with repository branches without a deploy target',()=>{
  assert.equal(allowedBranch('develop',branches(['develop','main'])),'develop');
  assert.throws(()=>allowedBranch('other',['develop','main']),/não está configurada/);
  assert.throws(()=>allowedBranch('main',['main'],['develop']),/não está configurada/);
});
test('commit message follows Conventional Commits and has at most two body lines',()=>{
  const message=conventionalMessage('feat','Adicionar fluxo',['src/a.ts','src/b.ts'],'2 files changed, 10 insertions');
  assert.match(message.subject,/^feat: /);
  assert.equal(message.body.split('\n').length,2);
  assert.throws(()=>conventionalMessage('../bad','x',['a'],'1 file'),/Tipo/);
  assert.match(conventionalMessage('docs','documentar a API',['README.md'],'1 file changed').subject,/^docs: /);
  assert.equal(validCommitType('security-review'),true);
  assert.equal(validCommitType('../bad'),false);
});
test('file paths reject option injection and traversal',()=>{
  assert.deepEqual(gitPaths(['src/a.ts','src/a.ts']),['src/a.ts']);
  for(const path of ['--all','../secret','/etc/passwd','.git/config','.env',':(top)secret','src/*','a\\b'])assert.throws(()=>gitPaths([path]));
});
test('commit draft uses the card execution summary and file changes',()=>{
  const suggestion=commitSuggestion('Corrigir card','Corrige abertura do cartão no calendário.',[{path:'apps/web/calendar.tsx',status:'modified'},{path:'apps/api/calendar.ts',status:'added'}]);
  assert.equal(suggestion.type,'fix');
  assert.equal(suggestion.subject,'Corrige abertura do cartão no calendário');
  assert.match(suggestion.description,/apps\/web\/calendar\.tsx/);
  assert.equal(suggestion.description.split('\n').length,2);
  assert.equal(commitSuggestion('Calendário','## Resumo\n- Corrige abertura do cartão.',[{path:'app.ts',status:'modified'}]).subject,'Corrige abertura do cartão');
  assert.equal(commitDescription('Resumo revisado\n2 arquivos alterados',''),'Resumo revisado\n2 arquivos alterados');
  assert.throws(()=>commitDescription('um\ndois\ntrês',''),/no máximo duas linhas/);
});
