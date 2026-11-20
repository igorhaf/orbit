import {currentIsolatedExecution,assertIsolatedExecutionRoot,isolatedCodexPolicy,isolatedProcessEnvironment,assertIsolatedExecutionDirectory} from './isolated-execution-policy';
import {spawnWorkspaceProcess} from './workspace-process';
import {currentWorkspaceWriteLease,assertWorkspaceWriteCoverage} from './workspace-coordinator';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Executor,ExecutionInput} from './types';
import {redact} from './security';
import {prepareOrbitCodexHome} from '../codex-home';
import {prepareContextDelivery} from './context-delivery';

// Adapter-specific process details never enter the Card domain or UI.
export class CodexExecutor implements Executor {
  id='codex';name='Codex local';
  actions=[
    {id:'analyze',name:'Analisar',permissions:['filesystem.read','process.execute']},
    {id:'implement-feature',name:'Implementar tarefa',permissions:['filesystem.read','filesystem.write','process.execute']},
    {id:'review-code',name:'Revisar',permissions:['filesystem.read','process.execute']},
  ];
  constructor(private available:()=>boolean=()=>true){}
  async execute(input:ExecutionInput){
    if(input.contextBridge)throw new Error('Context Bridge Codex não homologado; configuração MCP vazia preservada.');
    const lease=currentWorkspaceWriteLease();
    if(!lease)throw new Error('Execução mutável sem proteção compartilhada do workspace.');
    await lease.assertActive();
    await assertIsolatedExecutionRoot(input.projectRoot);
    await assertIsolatedExecutionDirectory(input.workingDirectory);
    await assertWorkspaceWriteCoverage(input.workingDirectory);
    if(!this.available())throw new Error("O plugin de IA está desativado.");
    const directory=await mkdtemp(join(tmpdir(),'orbit-run-')),output=join(directory,'result.txt');
    try{
      const env:NodeJS.ProcessEnv={};
      for(const key of ['PATH','HOME','CODEX_HOME','TMPDIR','LANG','LC_ALL'])if(process.env[key])env[key]=process.env[key];
      env.CODEX_HOME=await prepareOrbitCodexHome();
      const childEnvironment=currentIsolatedExecution()?isolatedProcessEnvironment(env.CODEX_HOME):env;
      const envelope=`Action: ${input.action}\nConfigured action permissions: ${input.permissions.join(', ')}\nWork only inside the selected checkout. Never modify Git refs, the index, worktree metadata, or the original checkout. Never read credentials or contact external services.\n\n${input.prompt}`;
      if(input.contextDelivery){const receipt=prepareContextDelivery(input.prompt,envelope,input.contextDelivery);await input.contextDelivery.onDelivery?.(receipt);}
      await new Promise<void>((resolve,reject)=>{
        const child=spawnWorkspaceProcess(process.env.CODEX_BIN||'codex',['exec',...(currentIsolatedExecution()?isolatedCodexPolicy(input.action==='implement-feature'&&input.permissions.includes('filesystem.write')):['--ignore-user-config','--dangerously-bypass-approvals-and-sandbox']),'--skip-git-repo-check','-c','mcp_servers={}','-C',input.workingDirectory,'--output-last-message',output,'-'],{env:childEnvironment,stdio:['pipe','ignore','pipe'],detached:process.platform!=='win32'});
        let reason:string|undefined,stderr='';let hardStop:ReturnType<typeof setTimeout>|undefined;
        const stop=()=>{reason=input.signal.aborted?'Execução cancelada.':'Tempo limite excedido.';try{process.kill(-child.pid!,'SIGTERM')}catch{child.kill('SIGTERM')}hardStop=setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL')}catch{child.kill('SIGKILL')}},2000);hardStop.unref()};
        input.signal.addEventListener('abort',stop,{once:true});
        const timer=setTimeout(stop,Math.min(Number(process.env.ORBIT_EXECUTION_TIMEOUT_MS)||300000,900000));
        child.stderr?.on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString()).slice(-2000)});
        child.stdin?.on('error',()=>{});
        child.stdin?.end(envelope);
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
