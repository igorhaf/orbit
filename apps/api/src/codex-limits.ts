import type { Db } from './db';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { prepareOrbitCodexHome } from './codex-home';

export type LimitWindow = { usedPercent:number; windowDurationMins:number; resetsAt:number };
type Snapshot = { primary?:LimitWindow|null; secondary?:LimitWindow|null };
export type CodexLimits = { rateLimits?:Snapshot; rateLimitsByLimitId?:Record<string,Snapshot> };

/** Read quotas through the supported CLI protocol, using the same login as execution. */
export async function readCodexLimits():Promise<CodexLimits> {
  const home=await prepareOrbitCodexHome();
  return new Promise((resolve,reject)=>{
    const child=spawn(process.env.CODEX_BIN||'codex',['app-server'],{env:{...process.env,CODEX_HOME:home},stdio:['pipe','pipe','ignore']});
    const lines=createInterface({input:child.stdout});
    let settled=false;
    const finish=(error?:Error,result?:CodexLimits)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);lines.close();child.kill();
      if(error)reject(error);else resolve(result||{});
    };
    const timer=setTimeout(()=>finish(new Error('A consulta dos limites do Codex excedeu o tempo de espera.')),15_000);
    child.on('error',()=>finish(new Error('Não foi possível iniciar a consulta dos limites do Codex.')));
    child.on('exit',()=>finish(new Error('O Codex encerrou a consulta de limites.')));
    child.stdin.on('error',()=>finish(new Error('Não foi possível comunicar com o Codex.')));
    const send=(message:unknown)=>child.stdin.write(JSON.stringify(message)+'\n');
    lines.on('line',line=>{
      let message:{id?:number;error?:unknown;result?:CodexLimits};
      try{message=JSON.parse(line)}catch{return}
      if(message.id!==1&&message.id!==2)return;
      if(message.error){finish(new Error('Limites indisponíveis. Verifique o login ChatGPT do Codex; contas com chave de API podem não fornecer essas janelas.'));return}
      if(message.id===1){send({method:'initialized'});send({id:2,method:'account/rateLimits/read'})}
      else finish(undefined,message.result);
    });
    send({id:1,method:'initialize',params:{clientInfo:{name:'orbit-limits',version:'1.0.0'}}});
  });
}

export function exhaustedQuotaKey(limits:CodexLimits):string {
  const snapshot=limits.rateLimitsByLimitId?.codex||limits.rateLimits;
  return [snapshot?.primary,snapshot?.secondary]
    .filter((window):window is LimitWindow=>!!window && [300,10080].includes(window.windowDurationMins) && Number.isFinite(window.usedPercent) && window.usedPercent>=99)
    .map(window=>window.windowDurationMins+':'+window.resetsAt).sort().join('|');
}
const monitors=new WeakMap<Db,{checked:number;pending?:Promise<void>}>();
export async function enforceCodexQuota(db:Db,force=false):Promise<void>{
  let monitor=monitors.get(db);
  if(!monitor){monitor={checked:0};monitors.set(db,monitor)}
  if(monitor.pending)return monitor.pending;
  if(!force&&Date.now()-monitor.checked<5_000)return;
  const state=monitor;
  state.pending=(async()=>{
    try{
      const key=exhaustedQuotaKey(await readCodexLimits());
      if(key)await db.query("UPDATE users SET preferences=COALESCE(preferences,'{}'::jsonb) || $2::jsonb WHERE COALESCE(preferences->>'codexQuotaAcknowledged','')<>$1",[key,JSON.stringify({codexQueuePaused:true,codexQueueAutoPaused:true,codexQuotaKey:key})]);
    }catch{
      // Keep the persisted queue state when quota data is unavailable.
    }finally{state.checked=Date.now();state.pending=undefined}
  })();
  return state.pending;
}
