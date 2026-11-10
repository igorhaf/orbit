import assert from 'node:assert/strict';
import {test} from 'node:test';
import {extractPromptSummary} from './prompt-result';

test('extracts AI commit metadata and keeps it out of the visible run summary',()=>{
  const result=extractPromptSummary(`Resposta de trabalho.\n[[ORBIT_SUMMARY]]\nImplementa pesquisa avançada.\n[[ORBIT_COMMIT_TYPE]]\nrefactor\n[[ORBIT_COMMIT_SUMMARY]]\nCentraliza a consulta de cartões.\nRemove a busca duplicada.\n[[/ORBIT_SUMMARY]]`);
  assert.equal(result.summary,'Implementa pesquisa avançada.');
  assert.equal(result.output,'Resposta de trabalho.');
  assert.deepEqual(result.commit,{type:'refactor',name:null,summary:'Centraliza a consulta de cartões.'});
});

test('accepts custom conventional types and ignores malformed types',()=>{
  const custom=extractPromptSummary('[[ORBIT_SUMMARY]]\nFeito.\n[[ORBIT_COMMIT_TYPE]]\nsecurity-review\n[[ORBIT_COMMIT_SUMMARY]]\nReduz exposição.\n[[/ORBIT_SUMMARY]]');
  assert.equal(custom.commit.type,'security-review');
  const invalid=extractPromptSummary('[[ORBIT_SUMMARY]]\nFeito.\n[[ORBIT_COMMIT_TYPE]]\n../secret\n[[ORBIT_COMMIT_SUMMARY]]\nResumo\n[[/ORBIT_SUMMARY]]');
  assert.equal(invalid.commit.type,null);
});
