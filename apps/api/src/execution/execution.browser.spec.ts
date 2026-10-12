import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';

const exec=promisify(execFile);
test('configured and converted cards use the current interface on desktop and touch screens',{timeout:180000},async()=>{
  const root=resolve(__dirname,'../../../..');
  const result=await exec(process.execPath,[resolve(root,'.orbit/validations/architecture-contract/architecture-contract.selenium.mjs')],{
    cwd:root,env:process.env,timeout:170000,maxBuffer:1024*1024,
  });
  process.stdout.write(result.stdout);
});
