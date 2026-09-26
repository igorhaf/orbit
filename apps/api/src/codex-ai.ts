import { Injectable } from '@nestjs/common';
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
          for(const line of lines){const message=this.progressMessage(line);if(message)progress?.(message.slice(0,2000));}
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
      const detail = error instanceof Error ? error.message : '';
      if (/ENOENT/.test(detail)) throw new Error('O executável local do Codex não foi encontrado. Configure CODEX_BIN no servidor.');
      throw new Error('Não foi possível gerar a sugestão com o Codex local.');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
