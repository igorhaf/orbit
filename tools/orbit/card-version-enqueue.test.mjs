import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Only enqueue is invoked. claim/finish would query Codex quota and are intentionally excluded.
test('generic enqueue pins captured revision, rejects preparation drift and preserves request-key idempotency', t => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const temporary = mkdtempSync(join(tmpdir(), 'orbit-card-enqueue-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const path = join(temporary, 'enqueue.test.ts');
  writeFileSync(path, `
    import assert from 'node:assert/strict';
    import {RunRepository} from ${JSON.stringify(resolve(root, 'packages/orbit-core/src/execution/run-repository.ts'))};
    import {emptyConfig} from ${JSON.stringify(resolve(root, 'packages/orbit-core/src/execution/types.ts'))};
    async function verify() {
      const queries: Array<{sql:string;args:unknown[]}> = [];
      let previous: Record<string,unknown>|null = null;
      let currentRevision=7;
      const client = {query:async(sql:string,args:unknown[]=[])=>{
        queries.push({sql,args});
        if(sql.startsWith('SELECT * FROM card_runs'))return {rows:previous?[previous]:[],rowCount:previous?1:0};
        if(sql.startsWith('SELECT card_revision FROM cards'))return {rows:[{card_revision:currentRevision}],rowCount:1};
        if(sql.startsWith('INSERT INTO card_runs('))return {rows:[{id:'run',card_revision:args[8]}],rowCount:1};
        return {rows:[],rowCount:0};
      }};
      const repository = new RunRepository({} as never);
      const card = {id:'card',title:'Base title',description:'Base demand',board_id:'board',card_revision:7};
      const result = await repository.enqueue(client as never,card,'user',emptyConfig(),'same-key');
      assert.equal(result.card_revision,7);
      const insert=queries.find(item=>item.sql.startsWith('INSERT INTO card_runs('));
      assert.ok(insert);assert.match(insert.sql,/request_key,card_revision/);
      assert.equal(insert.args[8],7);
      assert.deepEqual(JSON.parse(String(insert.args[6])).card,{id:'card',title:'Base title',description:'Base demand',card_revision:7});
      assert.equal(queries.filter(item=>item.sql.startsWith('INSERT INTO card_run_logs')).length,1);
      previous={id:'existing',card_revision:2,status:'success'};
      queries.length=0;
      const repeated=await repository.enqueue(client as never,{...card,card_revision:8},'user',emptyConfig(),'same-key');
      assert.equal(repeated,previous);
      assert.equal(repeated.card_revision,2);
      assert.equal(queries.filter(item=>item.sql.startsWith('INSERT')).length,0);
      assert.equal(queries.some(item=>item.sql.startsWith('SELECT card_revision FROM cards')),false);
      previous=null;currentRevision=8;queries.length=0;
      await assert.rejects(()=>repository.enqueue(client as never,card,'user',emptyConfig(),'new-key'),(error:unknown)=>{
        assert.equal((error as {code:string}).code,'CARD_REVISION_CONFLICT');return true;
      });
      assert.equal(queries.filter(item=>item.sql.startsWith('INSERT')).length,0);
    }
    verify().catch(error=>{console.error(error);process.exitCode=1;});
  `);
  assert.doesNotThrow(() => execFileSync(process.execPath, ['--import', resolve(root, 'dev/app/node_modules/tsx/dist/loader.mjs'), path], {
    cwd: temporary,
    env: { ...process.env, TSX_DISABLE_CACHE: '1', TSX_TSCONFIG_PATH: resolve(root, 'dev/app/apps/api/tsconfig.json') },
    stdio: 'pipe', timeout: 30_000,
  }));
});
