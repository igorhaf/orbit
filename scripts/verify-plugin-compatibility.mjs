import {readdirSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {inspectShared} from '../tools/orbit/shared.mjs';

const root = resolve(import.meta.dirname, '..');
const environments = ['forge', 'workspace', 'safdoulas', 'suinda', 'gastro-oceanica', 'rumo'];
const errors = [];
try {
  const config = JSON.parse(readFileSync(resolve(root, 'orbit.workspace.json'), 'utf8'));
  const shared = inspectShared({root, config});
  for (const diagnostic of shared.diagnostics) errors.push(`${diagnostic.path || diagnostic.package}: ${diagnostic.message}`);
  for (const projection of shared.projections) errors.push(`Projeção desatualizada: ${projection.path}`);
  for (const lock of shared.locks) errors.push(`Lock compartilhado desatualizado: ${lock.path}`);
} catch (error) {
  errors.push(`Fontes compartilhadas: ${error.message}`);
}
const sharedFiles = [
  'apps/api/core-version.json',
  'apps/api/src/plugins/core-compatibility.ts',
  'apps/api/src/plugins/contract.ts',
  'apps/api/src/plugins/sdk.ts',
  'apps/api/src/execution/registries.ts',
  'apps/api/src/plugins/records/records.service.ts',
  'apps/api/src/plugins/records/records.controller.ts',
  'apps/api/src/plugins/records/catalog.ts',
  'apps/api/src/plugins/records/documents.ts',
  'apps/api/src/keyring-crypto.ts',
  'apps/api/src/data-protector.ts',
  'apps/api/src/workspaces/workspace-branding.ts',
  'apps/api/src/workspaces/workspace-branding.spec.ts',
  'apps/web/components/modal.tsx',
  'apps/web/plugins/workspaces/WorkspaceBrandingSettings.tsx',
];

for (const relativePath of sharedFiles) {
  const contents = environments.map((environment) => {
    const path = resolve(root, environment, 'app', relativePath);
    try {
      return readFileSync(path, 'utf8');
    } catch {
      errors.push(`${environment}: arquivo ausente ${relativePath}`);
      return null;
    }
  });
  if (contents.some((value) => value !== null) && new Set(contents).size > 1) {
    errors.push(`Conteúdo divergente entre runtimes: ${relativePath}`);
  }
}

for (const environment of environments) {
  const app = resolve(root, environment, 'app');
  const base = resolve(root, environment, 'app/apps/api/src');
  const checks = [
    ['plugins/contract.ts', /coreCompatibility\?: import\(["']\.\/core-compatibility["']\)\.CoreCompatibility/],
    ['plugins/sdk.ts', /assertCoreCompatibility\(definition\)/],
    ['execution/registries.ts', /assertCoreCompatibility\(plugin\)/],
    ['access/access.ts', /registerRecordPermissionProvider\(/],
    ['access/access.ts', /authorizeRecord\(/],
  ];
  for (const [relativePath, pattern] of checks) {
    try {
      if (!pattern.test(readFileSync(resolve(base, relativePath), 'utf8'))) {
        errors.push(`${environment}: integração de compatibilidade ausente em ${relativePath}`);
      }
    } catch {
      errors.push(`${environment}: arquivo ausente ${relativePath}`);
    }
  }
  for (const [relativePath, pattern] of [
    ['apps/web/components/ui.tsx', /import \{ Modal \} from ['"]\.\/modal['"]/],
    ['apps/web/components/ui.tsx', /export \{ Modal \}/],
  ]) {
    try {
      if (!pattern.test(readFileSync(resolve(app, relativePath), 'utf8'))) {
        errors.push(`${environment}: modal desacoplado não integrado em ${relativePath}`);
      }
    } catch {
      errors.push(`${environment}: arquivo ausente ${relativePath}`);
    }
  }
  try {
    const ui = readFileSync(resolve(app, 'apps/web/components/ui.tsx'), 'utf8');
    const shellUi = readFileSync(resolve(app, 'apps/web/components/orbit-shell-ui.tsx'), 'utf8');
    const inboxUi = readFileSync(resolve(app, 'apps/web/components/orbit-inbox-panel.tsx'), 'utf8');
    const api = readFileSync(resolve(app, 'apps/web/lib/api.ts'), 'utf8');
    if (!/export \{[^}]*\bAppHeader\b/.test(ui) || !/export \{[^}]*\bWorkspaceSidebar\b/.test(ui)
      || !/export function AppHeader\b/.test(shellUi) || !/export function WorkspaceSidebar\b/.test(shellUi)
      || !/export function InboxPanel\b/.test(inboxUi)) {
      errors.push(`${environment}: fachada e módulos desacoplados da interface Orbit não preservam os exports públicos`);
    }
    for (const [label, valid] of [
      ['presença do ator ROOT durante a simulação', /is_root_actor/.test(shellUi)],
      ['seletor de perfil no header', /<select\b/.test(shellUi) && /Simular perfil/i.test(shellUi)],
      ['retorno explícito para ROOT', /Voltar a ROOT/.test(shellUi)],
      ['cabeçalho de simulação no cliente API', /X-Orbit-Profile-Simulation/.test(api)],
      ['envio do cabeçalho nas chamadas API', /profileSimulationHeaders\(\)|orbitApiHeaders\(\)/.test(api)],
    ]) {
      if (!valid) errors.push(`${environment}: contrato de simulação ROOT sem ${label}`);
    }
  } catch {
    errors.push(`${environment}: cliente ou header ausente para simulação ROOT`);
  }
  for (const relativePath of ['apps/api/src/env-settings.ts', '.env.example']) {
    const path = resolve(root, environment, 'app', relativePath);
    try {
      const contents = readFileSync(path, 'utf8');
      if (!contents.includes('ORBIT_DATA_ENCRYPTION_KEY')) {
        errors.push(`${environment}: configuração da chave de dados ausente em ${relativePath}`);
      }
      if (!contents.includes('ORBIT_DOCUMENT_SCANNER_URL')) {
        errors.push(`${environment}: configuração do scanner ausente em ${relativePath}`);
      }
    } catch {
      errors.push(`${environment}: arquivo ausente ${relativePath}`);
    }
  }

  try {
    const seed = readFileSync(resolve(app, 'apps/api/src/seed.ts'), 'utf8');
    const example = readFileSync(resolve(app, '.env.example'), 'utf8');
    if (!/await ensureBootstrapRoot\(pool\)/.test(seed) || /\$2[aby]\$\d{2}\$/.test(seed)) {
      errors.push(`${environment}: seed deve usar bootstrap genérico sem credencial histórica`);
    }
    for (const key of ['ORBIT_BOOTSTRAP_ROOT_NAME', 'ORBIT_BOOTSTRAP_ROOT_EMAIL', 'ORBIT_BOOTSTRAP_ROOT_PASSWORD']) {
      if (!example.includes(`${key}=`)) errors.push(`${environment}: exemplo de bootstrap sem ${key}`);
    }
  } catch {
    errors.push(`${environment}: arquivos de bootstrap genérico ausentes`);
  }

  for (const [relativePath, pattern] of [
    ['apps/api/src/main.ts', /registry\.register\(workspaceBrandingPlugin\)/],
    ['apps/api/src/main.ts', /WorkspaceBrandingService/],
    ['apps/api/src/main.ts', /WorkspaceBrandingController,PublicWorkspaceBrandingController/],
    ['apps/web/plugins/workspaces/WorkspacesPage.tsx', /<WorkspaceBrandingSettings\b/],
    ['apps/api/package.json', /src\/workspaces\/workspace-branding\.spec\.ts/],
  ]) {
    try {
      if (!pattern.test(readFileSync(resolve(app, relativePath), 'utf8'))) {
        errors.push(`${environment}: identidade genérica de workspace não integrada em ${relativePath}`);
      }
    } catch {
      errors.push(`${environment}: arquivo ausente ${relativePath}`);
    }
  }
  try {
    const migrations = readdirSync(resolve(app, 'apps/api/sql/migrations'));
    const migration = migrations.find((name) => /^\d+_workspace_branding\.sql$/.test(name));
    if (!migration) {
      errors.push(`${environment}: migration de identidade de workspace ausente`);
    } else {
      const sql = readFileSync(resolve(app, 'apps/api/sql/migrations', migration), 'utf8');
      for (const [label, pattern] of [
        ['tabela', /CREATE TABLE IF NOT EXISTS workspace_branding/],
        ['isolamento por workspace', /workspace_id uuid PRIMARY KEY REFERENCES workspaces\(id\) ON DELETE CASCADE/],
        ['unicidade de domínio', /UNIQUE INDEX IF NOT EXISTS workspace_branding_custom_domain_unique/],
        ['estado consistente de verificação', /workspace_branding_domain_state/],
      ]) {
        if (!pattern.test(sql)) errors.push(`${environment}: migration de identidade sem ${label}`);
      }
      if (/safdoulas|suindá|suinda/i.test(sql)) errors.push(`${environment}: migration genérica de identidade contém referência específica de produto`);
    }
  } catch {
    errors.push(`${environment}: diretório de migrations ausente`);
  }
  for (const relativePath of [
    'apps/api/src/workspaces/workspace-branding.ts',
    'apps/web/plugins/workspaces/WorkspaceBrandingSettings.tsx',
    'apps/web/components/modal.tsx',
  ]) {
    const contents = readFileSync(resolve(app, relativePath), 'utf8');
    if (/safdoulas|suindá|suinda/i.test(contents)) {
      errors.push(`${environment}: código genérico de identidade contém referência específica de produto em ${relativePath}`);
    }
  }
}

try {
  const learningPage = readFileSync(resolve(root, 'suinda/app/apps/web/app/suinda/learning/[id]/page.tsx'), 'utf8');
  if (!/import \{ Modal \} from ["']@\/components\/modal["']/.test(learningPage)) {
    errors.push('suinda: página de aprendizagem não importa o modal desacoplado');
  }
} catch {
  errors.push('suinda: página de aprendizagem ausente');
}

for (const relativePath of ['suinda/compose.yml', 'forge/app/tools/dev-runtime/runtime/suinda.compose.snapshot.yml']) {
  try {
    if (!/NEXT_PUBLIC_ORBIT_THEME:\s*dark\b/.test(readFileSync(resolve(root, relativePath), 'utf8'))) {
      errors.push(`suinda: tema escuro não fixado em ${relativePath}`);
    }
  } catch {
    errors.push(`suinda: configuração de runtime ausente em ${relativePath}`);
  }
}
try {
  const layout = readFileSync(resolve(root, 'suinda/app/apps/web/app/layout.tsx'), 'utf8');
  if (!/const initialTheme\s*=\s*forcedTheme\s*\|\|\s*'dark'/.test(layout) || !/data-theme=\{initialTheme\}/.test(layout) || !/data-theme-forced=\{forcedTheme\s*\?\s*'true'\s*:\s*undefined\}/.test(layout)) {
    errors.push('suinda: layout não aplica e fixa o tema definido pelo runtime');
  }
} catch {
  errors.push('suinda: layout raiz ausente para aplicar o tema do runtime');
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Compatibilidade de plugins alinhada em ${environments.length} runtimes.`);
}
