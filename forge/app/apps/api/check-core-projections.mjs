import { readFileSync } from 'node:fs';

const files = [
  'execution/editorial-authorization-generation.ts',
  'execution/editorial-plugin-settings-writer.ts',
  'execution/editorial-plugin-settings-orchestration.ts',
  'execution/editorial-plugin-settings-recovery.ts',
  'access/management.ts',
];

const here = new URL('.', import.meta.url);
const source = new URL('../../../../packages/orbit-core/src/', here);
for (const filename of files) {
  const canonical = new URL(filename, source);
  const projection = new URL('src/' + filename, here);
  try {
    if (readFileSync(canonical).equals(readFileSync(projection))) continue;
    console.error(`DEV Core projection differs: ${filename}`);
  } catch {
    console.error(`DEV Core projection or canonical source missing: ${filename}`);
  }
  process.exitCode = 1;
}
