import { HttpException, Injectable } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const MAX_OUTPUT = 20_000;
type Progress = (message:string)=>void;

@Injectable()
export class CodexAiService {
  async complete(instruction: string, model?: string, effort?: string): Promise<string> {
    return this.run(instruction, process.cwd(), 'read-only', model, effort);
  }
  async execute(instruction: string, projectPath: string, model: string, effort: string, progress?:Progress): Promise<string> {
    return this.run(instruction, projectPath, 'workspace-write', model, effort, progress);
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
  private reportedError(line:string):string|null {
    try {
      const event=JSON.parse(line) as {type?:string;message?:unknown;error?:unknown};
      if(event.type!=='error'&&event.type!=='turn.failed')return null;
      if(typeof event.message==='string')return event.message;
      if(typeof event.error==='string')return event.error;
      if(event.error&&typeof event.error==='object'&&'message' in event.error&&typeof (event.error as {message?:unknown}).message==='string')return (event.error as {message:string}).message;
    } catch { return null; }
    return null;
  }
  private executionError(detail:string):never {
    if(/(token|context).{0,80}(limit|exceed|quota|length|window)|(limit|exceed|quota).{0,80}(token|context)/i.test(detail))throw new HttpException('O limite de tokens desta execução foi excedido. Reduza o contexto ou a instrução e tente novamente.',429);
    if(/rate.?limit|too many requests|\b429\b/i.test(detail))throw new HttpException('O limite temporário de requisições do Codex foi atingido. Aguarde um momento e tente novamente.',429);
    if(/ENOENT/.test(detail))throw new HttpException('O executável local do Codex não foi encontrado. Configure CODEX_BIN no servidor.',503);
    throw new HttpException('Não foi possível gerar a sugestão com o Codex local.',502);
  }
  private async run(instruction: string, workingDirectory: string, sandbox: 'read-only'|'workspace-write', model?: string, effort?: string, progress?:Progress): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'orbit-codex-'));
    const output = join(directory, 'response.txt');
    const executable = process.env.CODEX_BIN || 'codex';
    const timeout = Number(process.env.CODEX_AI_TIMEOUT_MS || 90_000);

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, [
          'exec', '--ephemeral', '--sandbox', sandbox, '--skip-git-repo-check',
          ...(model ? ['--model', model] : []), ...(effort ? ['-c', `model_reasoning_effort=${JSON.stringify(effort)}`] : []),
          ...(progress ? ['--json'] : []),
          '--output-last-message', output, '-C', workingDirectory, instruction,
        ], { stdio: ['ignore', progress?'pipe':'ignore', 'pipe'] });
        let stderr = '';
        let stdout = '';
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error('A resposta do Codex excedeu o tempo limite.'));
        }, timeout);
        child.stdout?.on('data',(chunk:Buffer)=>{
          stdout+=chunk.toString();const lines=stdout.split(/\r?\n/);stdout=lines.pop()||'';
          for(const line of lines){const reported=this.reportedError(line);if(reported)stderr=(stderr+'\n'+reported).slice(-2000);const message=this.progressMessage(line);if(message)progress?.(message.slice(0,2000));}
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
      return text.slice(0, MAX_OUTPUT);
    } catch (error) {
      if(error instanceof HttpException)throw error;
      const detail = error instanceof Error ? error.message : '';
      this.executionError(detail);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
