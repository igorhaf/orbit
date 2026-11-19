import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareContextDelivery} from './context-delivery';
import {defaultContextCompilerPolicy} from './context-compiler';
import {hashContextText} from './context-manifest';
import {redactContext,redact} from './security';

test('delivery hashes the exact adapter envelope and verifies compiled material',()=>{
  const text='Demanda autorizada: ação e cuidado.',envelope='Host action policy\n'+text;
  const receipt=prepareContextDelivery(text,envelope,{compiledHash:hashContextText(text),policy:defaultContextCompilerPolicy()});
  assert.equal(receipt.compiledHash,hashContextText(text));assert.equal(receipt.envelopeHash,hashContextText(envelope));
  assert.equal(receipt.compiledEstimatedTokens,Buffer.byteLength(text));assert.equal(receipt.providerMemoryControlled,false);assert.equal(receipt.imageTokensKnown,false);
  assert.throws(()=>prepareContextDelivery(text+' altered',envelope,{compiledHash:hashContextText(text),policy:defaultContextCompilerPolicy()}),/diverge/);
  assert.throws(()=>prepareContextDelivery(text,'replaced',{compiledHash:hashContextText(text),policy:defaultContextCompilerPolicy()}),/substituiu/);
});

test('delivery refuses unbudgeted adapter overhead and never exposes source text',()=>{
  const text='task',policy=defaultContextCompilerPolicy({reservedExternalTokens:5});
  assert.throws(()=>prepareContextDelivery(text,'too much adapter overhead '+text,{compiledHash:hashContextText(text),policy}),/orçamento/);
  assert.ok(!JSON.stringify(prepareContextDelivery(text,'host '+text,{compiledHash:hashContextText(text),policy})).includes('host task'));
});

test('full context redaction preserves long mandatory tails and existing secret key patterns',()=>{
  const prefix='x-'.repeat(35000),body=prefix+' mandatory-tail';
  assert.equal(redactContext(body),body);assert.equal(redact(body),body.slice(0,64000));
  assert.equal(redactContext('api_key=fixturesecret password: fixturepass .private-key=privatevalue my-token=tokenvalue'), 'api_key=[REDACTED] password: [REDACTED] .private-key=[REDACTED] my-token=[REDACTED]');
});

test('Bridge dynamic data and adapter overhead share the same reserved compiler budget',()=>{
 const text='task',policy=defaultContextCompilerPolicy({reservedExternalTokens:100});
 assert.throws(()=>prepareContextDelivery(text,'x'.repeat(51)+text,{compiledHash:hashContextText(text),policy,dynamicContextBudgetBytes:50}),/orçamento/);
 const receipt=prepareContextDelivery(text,'host '+text,{compiledHash:hashContextText(text),policy,dynamicContextBudgetBytes:50});assert.equal(receipt.dynamicContextBudgetBytes,50);
});
