import assert from 'node:assert/strict';
import test from 'node:test';
import {diagnoseToolFailure,diagnoseToolFailures} from './tool-diagnostics';

test('does not treat an unmatched ripgrep search as a missing tool',()=>{
  assert.equal(diagnoseToolFailure({status:'error',activities:[{command:'rg -n pattern src',output:'',status:'failed',exitCode:1}]}),null);
});

test('reports a missing executable with installation commands',()=>{
  const issue=diagnoseToolFailure({status:'error',activities:[{command:'rg --files',output:'/bin/sh: rg: command not found',status:'failed',exitCode:127}]});
  assert.equal(issue?.kind,'missing');
  assert.equal(issue?.tool,'rg');
  assert.ok(issue?.installCommands.some(command=>command.includes('install -y ripgrep')));
});

test('recognizes an unavailable executable checked with command -v',()=>{
  const issue=diagnoseToolFailure({status:'error',activities:[{command:'command -v psql',output:'',status:'failed',exitCode:1}]});
  assert.equal(issue?.tool,'psql');
  assert.equal(issue?.kind,'missing');
});

test('lists multiple missing tools checked in one failed command without flagging found tools',()=>{
  const issues=diagnoseToolFailures({status:'error',activities:[{command:'command -v rg; command -v psql; command -v docker',output:'/usr/bin/rg',status:'failed',exitCode:1}]});
  assert.deepEqual(issues.map(issue=>issue.tool),['psql','docker']);
});

test('reports permission and malformed command issues without suggesting installation',()=>{
  const permission=diagnoseToolFailure({status:'error',error:'EACCES: permission denied'});
  const syntax=diagnoseToolFailure({status:'error',activities:[{command:"node -e 'broken'",output:'SyntaxError: missing ) after argument list',status:'failed',exitCode:1}]});
  assert.equal(permission?.kind,'permission');
  assert.deepEqual(permission?.installCommands,[]);
  assert.equal(syntax?.kind,'command');
  assert.deepEqual(syntax?.installCommands,[]);
});

test('only analyzes failed prompt runs',()=>{
  assert.equal(diagnoseToolFailure({status:'success',error:'command not found'}),null);
});

test('provides the Codex authentication recovery command',()=>{
  const issue=diagnoseToolFailure({status:'error',error:'Codex local não está autenticado. Execute codex login no servidor.'});
  assert.equal(issue?.kind,'authentication');
  assert.deepEqual(issue?.installCommands,['codex login']);
});
