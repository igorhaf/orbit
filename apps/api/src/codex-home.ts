import { lstat, mkdir, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Keeps Orbit's Codex history in the repository while reusing the server login. */
export async function prepareOrbitCodexHome(): Promise<string> {
  const orbitHome = resolve(__dirname, '..', '..', '..', '.orbit', 'sessions');
  const globalHome = resolve(process.env.CODEX_HOME || join(process.env.HOME || homedir(), '.codex'));
  await mkdir(orbitHome, { recursive: true });

  if (orbitHome !== globalHome) {
    const globalAuth = join(globalHome, 'auth.json');
    const orbitAuth = join(orbitHome, 'auth.json');
    try {
      await lstat(globalAuth);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return orbitHome;
      throw error;
    }
    try {
      await lstat(orbitAuth);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try {
        await symlink(globalAuth, orbitAuth);
      } catch (linkError) {
        if ((linkError as NodeJS.ErrnoException).code !== 'EEXIST') throw linkError;
      }
    }
  }

  return orbitHome;
}
