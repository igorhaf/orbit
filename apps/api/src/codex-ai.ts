import { Injectable } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const MAX_OUTPUT = 20_000;

@Injectable()
export class CodexAiService {
  async complete(instruction: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'orbit-codex-'));
    const output = join(directory, 'response.txt');
    const executable = process.env.CODEX_BIN || 'codex';
    const timeout = Number(process.env.CODEX_AI_TIMEOUT_MS || 90_000);

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, [
          'exec', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check',
          '--output-last-message', output, '-C', process.cwd(), instruction,
        ], { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error('A resposta do Codex excedeu o tempo limite.'));
        }, timeout);
        child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
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
