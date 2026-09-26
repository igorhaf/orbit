import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Executor,ExecutionInput} from './types';
import {redact} from './security';

// Adapter-specific process details never enter the Card domain or UI.
export class CodexExecutor implements Executor {
  id='codex';name='Codex local';
  actions=[
    {id:'analyze',name:'Analisar',permissions:['filesystem.read','process.execute']},
    {id:'implement-feature',name:'Implementar tarefa',permissions:['filesystem.read','filesystem.write','process.execute']},
    {id:'review-code',name:'Revisar',permissions:['filesystem.read','process.execute']},
  ];
  async execute(input:ExecutionInput){
    const directory=await mkdtemp(join(tmpdir(),'orbit-run-')),output=join(directory,'result.txt');
    try{
      const env:NodeJS.ProcessEnv={};
      for(const key of ['PATH','HOME','CODEX_HOME','TMPDIR','LANG','LC_ALL'])if(process.env[key])env[key]=process.env[key];
      await new Promise<void>((resolve,reject)=>{
        const child=spawn(process.env.CODEX_BIN||'codex',['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox',input.permissions.includes('filesystem.write')?'workspace-write':'read-only','-c','approval_policy="never"','-c','sandbox_workspace_write.network_access=false','-c','mcp_servers={}','-C',input.workingDirectory,'--output-last-message',output,'-'],{env,stdio:['pipe','ignore','pipe'],detached:process.platform!=='win32'});
        let reason:string|undefined,stderr='';let hardStop:ReturnType<typeof setTimeout>|undefined;
        const stop=()=>{reason=input.signal.aborted?'Execução cancelada.':'Tempo limite excedido.';try{process.kill(-child.pid!,'SIGTERM')}catch{child.kill('SIGTERM')}hardStop=setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL')}catch{child.kill('SIGKILL')}},2000);hardStop.unref()};
        input.signal.addEventListener('abort',stop,{once:true});
        const timer=setTimeout(stop,Math.min(Number(process.env.ORBIT_EXECUTION_TIMEOUT_MS)||300000,900000));
        child.stderr.on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString()).slice(-2000)});
        child.stdin.on('error',()=>{});
        child.stdin.end(`Action: ${input.action}\nPermissions: ${input.permissions.join(', ')}\nWork only inside the selected project. Never read credentials or contact external services.\n\n${input.prompt}`);
        const cleanup=()=>{clearTimeout(timer);if(hardStop)clearTimeout(hardStop);input.signal.removeEventListener('abort',stop)};
        child.on('error',error=>{cleanup();reject(new Error((error as NodeJS.ErrnoException).code==='ENOENT'?'Codex não encontrado no servidor.':'Não foi possível iniciar o executor.'))});
        child.on('close',code=>{cleanup();if(reason)reject(new Error(reason));else if(code!==0)reject(new Error(`Codex terminou com código ${code}: ${redact(stderr)}`));else resolve()});
        if(input.signal.aborted)stop();
      });
      const text=redact((await readFile(output,'utf8')).trim());
      if(!text)throw new Error('O executor não retornou resultado.');
      return {summary:text.slice(0,1000),outputs:[{type:'text',label:'Resposta',value:text}]};
    }finally{await rm(directory,{recursive:true,force:true})}
  }
}
