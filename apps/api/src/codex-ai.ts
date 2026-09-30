import { HttpException, Injectable } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const MAX_OUTPUT = 20_000;
type Progress = (message:string)=>void;
export type CodexExecution = { output:string; sessionId:string|null };
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
  async execute(instruction: string, projectPath: string, model: string, effort: string, progress?:Progress, sessionId?:string|null): Promise<CodexExecution> {
    const result=await this.run(instruction, projectPath, 'workspace-write', model, effort, progress, sessionId);
    return typeof result==='string'?{output:result,sessionId:sessionId||null}:result;
  }
  private progressMessage(line:string):string|null {
    try {
      const event=JSON.parse(line) as {type?:string;item?:{type?:string;text?:string;command?:string}};
      const item=event.item;
      if(item?.type==='agent_message'&&item.text)return item.text.trim();
      if(item?.type==='command_execution'&&item.command)return `Executando: ${item.command}`;
      if(item?.type==='reasoning')return 'Analisando a solicitação…';
      if(event.type==='turn.started')return 'Preparando a execução…';
      if(event.type==='turn.completed')return 'Finalizando a execução…';
      if(event.type==='error')return 'O Codex informou um erro.';
    } catch { return null; }
    return null;
  }
  private async run(instruction: string, workingDirectory: string, sandbox: 'read-only'|'workspace-write', model?: string, effort?: string, progress?:Progress, sessionId?:string|null): Promise<string|CodexExecution> {
    const directory = await mkdtemp(join(tmpdir(), 'orbit-codex-'));
    const output = join(directory, 'response.txt');
    const executable = process.env.CODEX_BIN || 'codex';
    const timeout = Number(process.env.CODEX_AI_TIMEOUT_MS || 300_000);
    let detectedSessionId: string|null = sessionId || null;

    try {
      await new Promise<void>((resolve, reject) => {
        const command = sessionId
          ? ['exec', '-C', workingDirectory, 'resume', sessionId, '--skip-git-repo-check']
          : ['exec', '--sandbox', sandbox, '--skip-git-repo-check', ...(model ? ['--model', model] : []), ...(effort ? ['-c', `model_reasoning_effort=${JSON.stringify(effort)}`] : []), '-C', workingDirectory];
        const child = spawn(executable, [
          ...command,
          ...(progress ? ['--json'] : []),
          '--output-last-message', output, instruction,
        ], { stdio: ['ignore', progress?'pipe':'ignore', 'pipe'] });
        let stderr = '';
        let stdout = '';
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error('A resposta do Codex excedeu o tempo limite.'));
        }, timeout);
        child.stdout?.on('data',(chunk:Buffer)=>{
          stdout+=chunk.toString();const lines=stdout.split(/\r?\n/);stdout=lines.pop()||'';
          for(const line of lines){
            try { const event=JSON.parse(line) as {type?:string;thread_id?:string}; if(event.type==='thread.started'&&typeof event.thread_id==='string') detectedSessionId=event.thread_id; } catch { /* Non-JSON output is ignored. */ }
            const message=this.progressMessage(line);if(message)progress?.(message.slice(0,2000));
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
      const text = (await readFile(output, 'utf8')).trim();
      if (!text) throw new Error('O Codex não retornou conteúdo.');
      const result={output:text.slice(0, MAX_OUTPUT),sessionId:detectedSessionId};
      return progress ? result : result.output;
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      throw new HttpException(codexErrorMessage(detail), 502);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
