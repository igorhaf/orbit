import {hashContextText,type ContextObject} from './context-manifest';
import {contextCompilerMaterialBudget,type ContextCompilerPolicy} from './context-compiler';

/** Internal host/adapter contract, never accepted from a card or document. */
export type ContextDeliveryContract = {
  compiledHash:string;policy:ContextCompilerPolicy;dynamicContextBudgetBytes?:number;
  onDelivery?:(receipt:ContextObject)=>Promise<void>|void;
};

/** Describes the exact text envelope controlled by Orbit, not provider memory or image tokens. */
export function prepareContextDelivery(compiledText:string,envelope:string,contract:ContextDeliveryContract):ContextObject {
  if(hashContextText(compiledText)!==contract.compiledHash)throw new Error('O material entregue diverge da compilação autorizada.');
  const budget=contract.policy.budget;
  const available=contextCompilerMaterialBudget(contract.policy);
  const compiledBytes=Buffer.byteLength(compiledText,'utf8'),envelopeBytes=Buffer.byteLength(envelope,'utf8');
  if(!envelope.includes(compiledText)||envelopeBytes<compiledBytes)throw new Error('O adaptador substituiu o contexto compilado.');
  const dynamic=contract.dynamicContextBudgetBytes??0;
  if(!Number.isSafeInteger(dynamic)||dynamic<0||dynamic>budget.reservedExternalTokens)throw new Error('Reserva de consultas dinâmicas inválida.');
  if(compiledBytes>available||envelopeBytes-compiledBytes+dynamic>budget.reservedExternalTokens||envelopeBytes+dynamic>available+budget.reservedExternalTokens)throw new Error('O envelope do executor excede o orçamento de contexto autorizado.');
  return {schemaVersion:1,boundary:'codex_cli_stdin',compiledHash:contract.compiledHash,envelopeHash:hashContextText(envelope),policy:contract.policy.id,estimator:'utf8-bytes-upper-bound/1',compiledEstimatedTokens:compiledBytes,envelopeEstimatedTokens:envelopeBytes,externalEstimatedTokens:envelopeBytes-compiledBytes,billableTokensKnown:false,providerMemoryControlled:false,imageTokensKnown:false,dynamicContextBudgetBytes:dynamic};
}
