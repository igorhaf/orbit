import {spawn} from 'node:child_process';

export type ManagedProcessResult={code:number|null;signal:NodeJS.Signals|null;stdout:string;stderr:string};
export type ManagedProcessOptions={cwd:string;timeoutMs:number;killGraceMs?:number;maxOutputBytes?:number;signal?:AbortSignal};

/** Runs one argv command with a hard deadline and cleans up its entire process group. */
export function runManagedProcess(file:string,args:string[],options:ManagedProcessOptions):Promise<ManagedProcessResult>{
  return new Promise((resolve,reject)=>{
    if(options.signal?.aborted){reject(new Error('O comando foi cancelado antes de iniciar.'));return}
    const child=spawn(file,args,{cwd:options.cwd,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32',shell:false});
    const outputLimit=options.maxOutputBytes??256*1024;
    let stdout='';let stderr='';let settled=false;let stopReason:string|null=null;let killTimer:ReturnType<typeof setTimeout>|undefined;
    const append=(current:string,chunk:Buffer)=>`${current}${chunk.toString()}`.slice(-outputLimit);
    const clear=()=>{clearTimeout(timeoutTimer);options.signal?.removeEventListener('abort',abort);if(killTimer&&!stopReason)clearTimeout(killTimer)};
    const signal=(value:NodeJS.Signals)=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,value);else child.kill(value)}catch{/* Process already exited. */}};
    const finish=(error?:Error,result?:ManagedProcessResult)=>{if(settled)return;settled=true;clear();if(error)reject(error);else resolve(result!)};
    const stop=(reason:string)=>{
      if(settled||stopReason)return;
      stopReason=reason;signal('SIGTERM');
      killTimer=setTimeout(()=>{signal('SIGKILL');killTimer=undefined;finish(new Error(reason))},options.killGraceMs??1000);
      killTimer.unref();
    };
    const abort=()=>stop('O comando foi cancelado porque a execução deixou de estar ativa.');
    const timeoutTimer=setTimeout(()=>stop(`O comando ${file} excedeu o prazo de ${options.timeoutMs} ms.`),options.timeoutMs);
    timeoutTimer.unref();
    options.signal?.addEventListener('abort',abort,{once:true});
    child.stdout?.on('data',(chunk:Buffer)=>{stdout=append(stdout,chunk)});
    child.stderr?.on('data',(chunk:Buffer)=>{stderr=append(stderr,chunk)});
    child.once('error',(error)=>finish(error));
    child.once('close',(code,terminationSignal)=>{
      if(stopReason)finish(new Error(stopReason));
      else finish(undefined,{code,signal:terminationSignal,stdout,stderr});
    });
  });
}
