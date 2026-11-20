import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {CodexAiService} from '../../../apps/api/src/codex-ai';
import {interpretation,interpretationPrompt} from '../../../apps/api/src/alexa-orbit/interpretation';
async function main(){
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 try{
 const settings=(await pool.query('SELECT ai_default_model,ai_default_effort FROM users WHERE email=$1',['igorhaf@gmail.com'])).rows[0];assert(settings?.ai_default_model&&settings.ai_default_effort);
 const ai=new CodexAiService();
 const efforts=process.argv.includes('--benchmark')?[settings.ai_default_effort,'low']:['low'];
 for(const effort of efforts)for(const [speech,expected] of [['preciso comprar café','purchase'],['tenho dentista mas não sei o dia ainda','clarify']]){
 const start=Date.now();const result=interpretation(await ai.complete(interpretationPrompt(speech,'America/Recife',new Date().toISOString(),''),settings.ai_default_model,effort),'America/Recife');assert.equal(result.kind,expected);assert(result.summary,'Real AI must provide ORBIT_SUMMARY');console.log(`PASS real authenticated Codex classification: ${expected}, effort=${effort}, ${Date.now()-start}ms, one-line ORBIT_SUMMARY`);
 }
 if(!process.argv.includes('--benchmark')){
 const history=[{role:'user' as const,text:'Tenho dentista amanhã.',receivedAt:'2026-10-12T12:00:00Z'},{role:'assistant' as const,text:'Qual horário?',receivedAt:'2026-10-12T12:00:00Z'}];
 const start=Date.now();const result=interpretation(await ai.complete(interpretationPrompt('Às quinze horas.','America/Recife','2026-10-12T12:02:00Z','',history),settings.ai_default_model,'low'),'America/Recife');assert.equal(result.kind,'appointment');if(result.kind==='appointment'){assert.equal(result.date,'2026-10-13');assert.equal(result.time,'15:00')};assert(result.summary);console.log(`PASS real low-effort dialogue: appointment from clarification history, ${Date.now()-start}ms`);
 }
 }finally{await pool.end()}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Validation failed');process.exitCode=1});
