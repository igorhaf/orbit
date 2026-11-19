import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(new URL('../../dev/app/package.json', import.meta.url));
const ts = require('typescript');

for (const runtime of ['dev', 'prod', 'safdoulas', 'suinda']) {
  test(`${runtime}: revision UI distinguishes current, pending, stale and legacy without executing API module`, () => {
    const source = readFileSync(new URL(`../../${runtime}/app/apps/web/lib/api.ts`, import.meta.url), 'utf8');
    const marker = 'export type RunRevisionFreshness =';
    assert.equal(source.split(marker).length, 2, 'revision helper section must be unique');
    // Compile only the pure helpers, avoiding module-level API/session/environment code.
    const code = ts.transpileModule(source.slice(source.indexOf(marker)), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const sandbox = { exports: {} };
    vm.runInNewContext(code, sandbox, { timeout: 1000 });
    const { runRevisionFreshness: state, runRevisionLabel: label } = sandbox.exports;
    assert.equal(state({ card_revision: 2, current_card_revision: 2 }), 'current');
    assert.equal(state({ card_revision: 2, current_card_revision: 3, freshness: 'current' }), 'stale');
    assert.equal(state({ card_revision: 2, current_card_revision: 2 }, 3), 'stale');
    assert.equal(state({ card_revision: 3, current_card_revision: 3 }, 2), 'current');
    assert.equal(state({ card_revision: null, current_card_revision: 3 }), 'unversioned');
    assert.equal(state({ card_revision: 2 }), 'unversioned');
    assert.equal(state({ card_revision: 2, current_card_revision: 2, status: 'queued' }), 'pending');
    assert.equal(state({ card_revision: 2, current_card_revision: 2, status: 'waiting_answer' }), 'pending');
    assert.equal(state({ card_revision: 2, current_card_revision: 3, status: 'running' }), 'stale');
    assert.match(label({ card_revision: 2, current_card_revision: 3 }), /revisão anterior/);
    assert.match(label({ card_revision: null }), /sem revisão registrada/);
    assert.match(label({ card_revision: 2, current_card_revision: 2, status: 'running' }), /Ainda não há resultado final/);
  });

  test(`${runtime}: overwrite action is version-guarded and old outputs remain visible`, () => {
    const summary = readFileSync(new URL(`../../${runtime}/app/apps/web/components/card-dialog.tsx`, import.meta.url), 'utf8');
    assert.match(summary, /disabled=\{busy \|\| freshness!=="current"\}/);
    assert.match(summary, /description: summary, expected_card_revision: run\.card_revision/);
    assert.match(summary, /\[card\.id, card\.card_revision, runStatus\]/);
    assert.match(summary, /\{summary\}<\/p>/, 'summary remains rendered even when stale');
    const execution = readFileSync(new URL(`../../${runtime}/app/apps/web/components/prompt-execution.tsx`, import.meta.url), 'utf8');
    assert.match(execution, /runRevisionLabel\(displayedRun,card\.card_revision\)/);
    assert.match(execution, /\{output&&<LiveMarkdown text=\{output\}\/>\}/, 'output rendering does not depend on freshness');
  });
}
