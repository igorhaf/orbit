import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareText, mergeText } from './review';

test('side by side review merges chosen hunks without modifying either version',()=>{
  const before='one\ntwo\nthree\nfour\n';
  const after='ONE\ntwo\nthree\nFOUR\n';
  const {sections,tooLarge}=compareText(before,after);
  assert.equal(tooLarge,false);
  assert.equal(sections.filter(section=>section.kind==='change').length,2);
  assert.equal(mergeText(sections,[true,false]),'ONE\ntwo\nthree\nfour\n');
  assert.equal(mergeText(sections,[false,true]),'one\ntwo\nthree\nFOUR\n');
  assert.throws(()=>mergeText(sections,[true]),/Seleção/);
});

test('large files remain available for full-file staging',()=>{
  assert.equal(compareText('a'.repeat(120_001),'b').tooLarge,true);
});
