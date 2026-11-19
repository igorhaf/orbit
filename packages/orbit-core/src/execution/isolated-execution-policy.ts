import {AsyncLocalStorage} from 'node:async_hooks';
import {realpath} from 'node:fs/promises';
import {isAbsolute,relative} from 'node:path';

/** Host authority, never derived from a prompt or from a plugin declaration. */
export type IsolatedExecutionContext={runId:string;queue:'card_runs'|'card_ai_runs';root:string;baseCommit:string;cardRevision:number|null};
const execution=new AsyncLocalStorage<IsolatedExecutionContext>();
export const currentIsolatedExecution=()=>execution.getStore();
export async function withIsolatedExecution<T>(context:IsolatedExecutionContext,callback:()=>Promise<T>):Promise<T>{
  if(execution.getStore())throw new Error('Uma execução isolada não pode trocar sua identidade durante o callback.');
  return execution.run({...context,root:await realpath(context.root)},callback);
}
export async function assertIsolatedExecutionRoot(root:string){
  const context=execution.getStore();
  if(context&&await realpath(root)!==context.root)throw new Error('O executor não recebeu a worktree autorizada deste run.');
}
/** This requests the provider's sandbox; it is not an OS sandbox for arbitrary plugins. */
export const isolatedCodexPolicy=(writable=true)=>['--ignore-user-config','--sandbox',writable?'workspace-write':'read-only','-c','approval_policy="never"','-c','mcp_servers={}','-c','sandbox_workspace_write.network_access=false','-c','sandbox_workspace_write.exclude_tmpdir_env_var=true','-c','sandbox_workspace_write.exclude_slash_tmp=true'];
export function assertIsolatedChecks(checks:readonly unknown[]){
  if(execution.getStore()&&checks.length)throw new Error('Verificações deste projeto exigem provisionamento e autoridade de efeitos externos ainda não homologados para worktree isolada.');
}

export const isolatedProcessEnvironment=(codexHome?:string):NodeJS.ProcessEnv=>({PATH:'/usr/bin:/bin',HOME:'/nonexistent',LANG:'C.UTF-8',LC_ALL:'C.UTF-8',...(codexHome?{CODEX_HOME:codexHome}:{}),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_NO_REPLACE_OBJECTS:'1'});

export async function assertIsolatedExecutionDirectory(directory:string){
  const context=execution.getStore();if(!context)return;
  const target=await realpath(directory),path=relative(context.root,target);
  if(path==='..'||path.startsWith('../')||isAbsolute(path))throw new Error('Diretório do executor está fora da worktree autorizada.');
}
