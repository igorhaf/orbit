import { HttpException, Injectable } from '@nestjs/common';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';

const MAX_OUTPUT = 20_000;
const stripAnsi=(value:string)=>value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`,'g'),'');
export type PromptFileChange = {path:string;kind:'add'|'delete'|'update';additions:number;deletions:number;diff:string};
export type PromptActivity = {id:string;kind:'command';command:string;output:string;status:'running'|'completed'|'failed';exitCode?:number};
type ProgressDetails = {fileChanges?:Array<Pick<PromptFileChange,'path'|'kind'>>;activity?:PromptActivity};
type Progress = (message:string,output?:boolean,replace?:boolean,details?:ProgressDetails)=>void;
export type CodexExecution = { output:string; sessionId:string|null;fileChanges:PromptFileChange[];activities:PromptActivity[] };
export const codexErrorMessage=(detail:string) => {
  if (/ENOENT/.test(detail)) return 'O executável local do Codex não foi encontrado. Configure CODEX_BIN no servidor.';
  if (/mountinfo path is not absolute/i.test(detail)) return 'O Codex CLI instalado tem uma falha no sandbox Linux (mountinfo path is not absolute). Atualize o CODEX_BIN para uma versão estável posterior à correção e reinicie a API.';
  if (/tempo limite/i.test(detail)) return detail;
  if (/(?:usage limit|rate limit|quota|insufficient_quota|too many requests|credits? exhausted)/i.test(detail)) return 'O limite de uso ou de tokens da conta do Codex foi excedido. Verifique sua cota e tente novamente mais tarde.';
  if (/(?:context length|context window|maximum.*tokens|too many tokens|token limit)/i.test(detail)) return 'A solicitação excedeu o limite de tokens do modelo. Reduza o conteúdo ou divida a tarefa em partes menores.';
  return 'Não foi possível gerar a sugestão com o Codex local.';
};

@Injectable()
export class CodexAiService {
  async complete(instruction: string, model?: string, effort?: string): Promise<string> {
    const result=await this.run(instruction, process.cwd(), 'read-only', model, effort);
    return typeof result==='string'?result:result.output;
  }
  async execute(instruction: string, projectPath: string, model: string, effort: string, progress?:Progress, sessionId?:string|null, onSessionId?:(id:string)=>Promise<void>|void): Promise<CodexExecution> {
    const result=await this.run(instruction, projectPath, 'workspace-write', model, effort, progress, sessionId, onSessionId);
    return typeof result==='string'?{output:result,sessionId:sessionId||null,fileChanges:[],activities:[]}:result;
  }
  private progressMessage(line:string):{message:string;output?:boolean;delta?:boolean;replace?:boolean;cumulative?:boolean;itemId?:string;fileChanges?:Array<{path:string;kind:'add'|'delete'|'update'}>;activity?:PromptActivity}|null {
    try {
      const event=JSON.parse(line) as {type?:string;delta?:string;text?:string;item_id?:string;item?:{id?:string;type?:string;text?:string;delta?:string;command?:string;aggregated_output?:string;output?:string;changes?:{path?:string;kind?:string}[];status?:string;exit_code?:number}};
      const item=event.item;
      if((event.type==='message.delta'||event.type==='item/agentMessage/delta'||event.type==='item/agent_message/delta')&&(event.delta||item?.delta))return {message:event.delta||item?.delta||'',output:true,delta:true};
      if(event.type==='item.updated'&&item?.type==='agent_message'&&typeof item.text==='string')return {message:item.text,output:true,cumulative:true,itemId:item.id||event.item_id};
      if((event.type==='item.completed'||event.type==='item/agentMessage/completed')&&item?.type==='agent_message'&&item.text)return {message:item.text,output:true};
      if(item?.type==='command_execution'){
        const status=item.status==='completed'?'completed':item.status==='failed'||item.status==='declined'?'failed':'running';
        return {message:'',activity:{id:item.id||event.item_id||`command-${Date.now()}`,kind:'command',command:item.command||'Comando em execução',output:stripAnsi(item.aggregated_output||item.output||'').slice(-3000),status,...(typeof item.exit_code==='number'?{exitCode:item.exit_code}:{})}};
      }
      if(item?.type==='file_change'&&Array.isArray(item.changes)){
        const fileChanges=item.changes.filter(change=>typeof change.path==='string'&&['add','delete','update'].includes(change.kind||'')).map(change=>({path:change.path!,kind:change.kind as 'add'|'delete'|'update'}));
        if(item.status==='failed')return {message:'A alteração de arquivos falhou.'};
        if(fileChanges.length)return {message:`${fileChanges.length} arquivo${fileChanges.length===1?'':'s'} editado${fileChanges.length===1?'':'s'}.`,fileChanges};
      }
      if(item?.type==='reasoning')return {message:'Analisando a solicitação…'};
      if(event.type==='turn.started')return {message:'Preparando a execução…'};
      if(event.type==='turn.completed')return {message:'Finalizando a execução…'};
      if(event.type==='error')return {message:'O Codex informou um erro.'};
    } catch { return null; }
    return null;
  }
  private async run(instruction: string, workingDirectory: string, sandbox: 'read-only'|'workspace-write', model?: string, effort?: string, progress?:Progress, sessionId?:string|null, onSessionId?:(id:string)=>Promise<void>|void): Promise<string|CodexExecution> {
    const directory = await mkdtemp(join(tmpdir(), 'orbit-codex-'));
    const output = join(directory, 'response.txt');
    const executable = process.env.CODEX_BIN || 'codex';
    const timeout = Number(process.env.CODEX_AI_TIMEOUT_MS || 300_000);
    let detectedSessionId: string|null = sessionId || null;
    const changedFiles=new Map<string,'add'|'delete'|'update'>();
    const activities=new Map<string,PromptActivity>();
    const dispatchedActivities=new Map<string,{output:string;at:number}>();
    let sessionPersistence=Promise.resolve();
    let sessionPersistenceError:unknown;

    try {
      await new Promise<void>((resolve, reject) => {
        const command = sessionId
          ? ['exec', '-C', workingDirectory, 'resume', sessionId, '--skip-git-repo-check', ...(model ? ['--model', model] : []), ...(effort ? ['-c', `model_reasoning_effort=${JSON.stringify(effort)}`] : [])]
          : ['exec', '--sandbox', sandbox, '--skip-git-repo-check', ...(model ? ['--model', model] : []), ...(effort ? ['-c', `model_reasoning_effort=${JSON.stringify(effort)}`] : []), '-C', workingDirectory];
        const child = spawn(executable, [
          ...command,
          ...(progress ? ['--json'] : []),
          '--output-last-message', output, instruction,
        ], { stdio: ['ignore', progress?'pipe':'ignore', 'pipe'] });
        let stderr = '';
        let stdout = '';
        let receivedOutputDelta=false;
        const streamedItems=new Map<string,string>();
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error('A resposta do Codex excedeu o tempo limite.'));
        }, timeout);
        child.stdout?.on('data',(chunk:Buffer)=>{
          stdout+=chunk.toString();const lines=stdout.split(/\r?\n/);stdout=lines.pop()||'';
          for(const line of lines){
            try {
              const event=JSON.parse(line) as {type?:string;thread_id?:string};
              if(event.type==='thread.started'&&typeof event.thread_id==='string'){
                detectedSessionId=event.thread_id;
                sessionPersistence=sessionPersistence.then(async()=>{
                  try { await onSessionId?.(event.thread_id!); }
                  catch(error) { sessionPersistenceError=error; }
                });
              }
            } catch { /* Non-JSON output is ignored. */ }
            const update=this.progressMessage(line);
            if(update?.fileChanges){
              const normalized=update.fileChanges.flatMap(change=>{
                const absolute=isAbsolute(change.path)?resolvePath(change.path):resolvePath(workingDirectory,change.path);
                const path=relative(workingDirectory,absolute).split(sep).join('/');
                return path&&!path.startsWith('../')&&path!=='..'? [{path,kind:change.kind}]:[];
              });
              for(const change of normalized)changedFiles.set(change.path,change.kind);
              if(normalized.length)progress?.(update.message,false,false,{fileChanges:normalized});
            }
            if(update?.activity){
              activities.set(update.activity.id,update.activity);
              const previous=dispatchedActivities.get(update.activity.id);const now=Date.now();
              const shouldDispatch=update.activity.status!=='running'||!previous||now-previous.at>=1500||(update.activity.output.length<3000&&update.activity.output.length-previous.output.length>=600);
              if(shouldDispatch&&(!previous||previous.output!==update.activity.output||previous.at===0||update.activity.status!=='running')){
                dispatchedActivities.set(update.activity.id,{output:update.activity.output,at:now});
                progress?.('',false,false,{activity:update.activity});
              }
            }
            if(update?.output){
              if(update.delta){receivedOutputDelta=true;progress?.(update.message,true);}
              else if(update.cumulative&&update.itemId){
                receivedOutputDelta=true;
                const previous=streamedItems.get(update.itemId)||'';streamedItems.set(update.itemId,update.message);
                const append=update.message.startsWith(previous);
                const fragment=append?update.message.slice(previous.length):update.message;
                if(fragment)progress?.(fragment,true,!append);
              }else if(update.cumulative){receivedOutputDelta=true;progress?.(update.message,true,true);}
              else if(!receivedOutputDelta)progress?.(update.message,true);
            }
            else if(update&&!update.fileChanges&&!update.activity)progress?.(update.message.slice(0,2000));
          }
        });
        child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', code => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(stderr || 'O Codex não conseguiu concluir a solicitação.'));
        });
      });
      await sessionPersistence;
      if(sessionPersistenceError)throw sessionPersistenceError;
      const text = (await readFile(output, 'utf8')).trim();
      if (!text) throw new Error('O Codex não retornou conteúdo.');
      const fileChanges=progress?await this.reviewFileChanges(workingDirectory,[...changedFiles].map(([path,kind])=>({path,kind}))):[];
      const result={output:text.slice(0, MAX_OUTPUT),sessionId:detectedSessionId,fileChanges,activities:[...activities.values()]};
      return progress ? result : result.output;
    } catch (error) {
      await sessionPersistence;
      const failure=sessionPersistenceError||error;
      const detail = failure instanceof Error ? failure.message : '';
      throw new HttpException(codexErrorMessage(detail), 502);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async reviewFileChanges(workingDirectory:string,changes:Array<{path:string;kind:'add'|'delete'|'update'}>):Promise<PromptFileChange[]> {
    const safe=changes.slice(0,100);
    const runGit=(args:string[])=>new Promise<string>(resolveOutput=>execFile('git',args,{cwd:workingDirectory,encoding:'utf8',maxBuffer:512*1024},(_error,stdout)=>resolveOutput(stdout||'')));
    const reviewed:PromptFileChange[]=[];
    for(const change of safe){
      let diff='';
      try{
        diff=(await runGit(['diff','--no-ext-diff','--no-color','--unified=3','--',change.path]))+(await runGit(['diff','--cached','--no-ext-diff','--no-color','--unified=3','--',change.path]));
        if(!diff&&change.kind==='add'){
          const absolute=resolvePath(workingDirectory,change.path);
          const root=await realpath(workingDirectory);const actual=await realpath(absolute);
          if(actual.startsWith(root+sep)){
            const details=await stat(actual);
            if(details.isFile()&&details.size<=128*1024){const contents=await readFile(actual,'utf8');diff=`--- /dev/null\n+++ b/${change.path}\n${contents.split(/\r?\n/).map(line=>`+${line}`).join('\n')}`;}
          }
        }
      }catch{/* O resumo de arquivos ainda pode ser exibido sem diff. */}
      diff=diff.slice(0,30000);
      const lines=diff.split(/\r?\n/);
      reviewed.push({...change,additions:lines.filter(line=>line.startsWith('+')&&!line.startsWith('+++')).length,deletions:lines.filter(line=>line.startsWith('-')&&!line.startsWith('---')).length,diff});
    }
    return reviewed;
  }
}
