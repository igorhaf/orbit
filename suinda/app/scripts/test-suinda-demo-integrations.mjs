#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const externalChecklist = resolve(root, "docs/suinda/PRE-REQUISITOS-EXTERNOS.md");

// IDs are expanded individually so the runner can reject duplicates and drift
// from the external checklist instead of silently skipping a requirement.
const scenarios = [
  {
    ids: ["1.3"],
    title: "Descoberta OIDC, rotas de callback e limites de autenticação",
    files: ["access/access.spec.ts"],
    evidence: "fixture de guard e catálogo de provedores; não executa login num IdP real",
    coverage: "partial-fixture",
  },
  {
    ids: ["1.4", "1.5", "1.6", "17.6", "32.10"],
    title: "Convites, verificação, recuperação, MFA e mensagens de conta",
    files: ["access/auth-lifecycle.spec.ts", "mail/mail.spec.ts", "plugins/workspace-email-templates.spec.ts"],
    evidence: "mailer substituído por captura de mensagens de teste; erros de envio também são exercitados",
  },
  {
    ids: ["5.9", "32.7"],
    title: "Picker/Drive, anexos de aula e validação de mídia externa",
    files: ["plugins/suinda-google-drive.spec.ts", "google/backup.spec.ts", "plugins/suinda/suinda.spec.ts"],
    evidence: "respostas de arquivos/players sintéticas e acesso ao arquivo limitado ao escopo autorizado",
  },
  {
    ids: ["6.2", "32.3"],
    title: "Google Calendar e criação idempotente de reunião Meet",
    files: ["calendar/calendar.spec.ts", "plugins/suinda/suinda-calendar.provider.spec.ts", "plugins/suinda/suinda.spec.ts"],
    evidence: "conta, evento e URL Meet de fixture; nenhuma chamada ao Google",
  },
  {
    ids: ["6.3", "32.4"],
    title: "Zoom OAuth, reunião, reconciliação e URL segura de participante",
    files: ["zoom/zoom-meetings.spec.ts"],
    evidence: "tokens, reuniões e participantes fornecidos por fetcher fake",
  },
  {
    ids: ["6.4", "32.5"],
    title: "Outlook/Teams Calendar, eventos, delta e assinaturas",
    files: ["calendar/microsoft-calendar.spec.ts"],
    evidence: "Graph e tokens simulados por serviço de teste",
  },
  {
    ids: ["6.5"],
    title: "Importação de presença de reuniões concluídas",
    files: ["google/meet-attendance.spec.ts", "calendar/microsoft-teams-attendance.spec.ts", "plugins/suinda/suinda.spec.ts"],
    evidence: "relatórios/páginas e identidades sintéticas; ambiguidades e escopo inválido são recusados",
  },
  {
    ids: ["12.4"],
    title: "Progresso de mídia, checkpoints e falha dos players",
    files: ["plugins/suinda/suinda.spec.ts"],
    evidence: "callbacks e checkpoints de mídia sintéticos; não reproduz conteúdo de YouTube/Vimeo real",
  },
  {
    ids: ["13.4"],
    title: "Assinatura de certificado com autoridade de teste",
    files: ["plugins/suinda-certificate-signing.spec.ts"],
    evidence: "PKCS#12 e cadeia de certificado exclusivamente de fixture; não declara ICP-Brasil",
  },
  {
    ids: ["15.6", "15.7", "15.8", "15.9", "15.10", "32.11"],
    title: "Checkout, cobrança, webhook de pagamento, negociação e conciliação",
    files: ["plugins/suinda/mercado-pago.spec.ts", "plugins/suinda/mercado-pago-settlement.spec.ts", "plugins/suinda/finance.spec.ts", "plugins/suinda-financial-negotiation.spec.ts", "plugins/suinda-subscriptions.spec.ts"],
    evidence: "pagamentos, recusas, relatórios e liquidações de fixture; sem credencial de gateway",
  },
  {
    ids: ["17.7", "32.9"],
    title: "WhatsApp Business: consentimento, template aprovado e idempotência",
    files: ["plugins/suinda-whatsapp.spec.ts"],
    evidence: "respostas/falhas Graph API simuladas; nenhum número ou template real é usado",
  },
  {
    ids: ["17.8"],
    title: "Push Web com chaves VAPID descartáveis e sender substituído",
    files: ["plugins/notifications.spec.ts"],
    evidence: "chaves geradas apenas no processo e sendNotification interceptado",
  },
  {
    ids: ["21.11", "32.6"],
    title: "Sincronização bidirecional de calendários e recuperação de cursor",
    files: ["calendar/calendar.spec.ts", "calendar/microsoft-calendar.spec.ts", "plugins/suinda/suinda-calendar.provider.spec.ts"],
    evidence: "eventos, recorrências e cursores de fixture; sem contas Google/Microsoft",
  },
  {
    ids: ["29.3"],
    title: "Configuração de URLs públicas, host permitido e políticas de origem",
    files: ["env-settings.spec.ts", "workspaces/workspace-branding.spec.ts"],
    evidence: "hosts de exemplo e rejeição de origem insegura; DNS/TLS público não é simulado como aprovado",
    coverage: "partial-fixture",
  },
  {
    ids: ["30.6", "30.7"],
    title: "Solicitações de privacidade e eliminação que falha fechada sem política aprovada",
    files: ["plugins/suinda/suinda-privacy.spec.ts"],
    evidence: "titulares, categorias, anexos e decisões de fixture; nenhuma pessoa real é apagada",
  },
  {
    ids: ["32.2"],
    title: "Webhook assinado, idempotência, tentativas e destinos inseguros",
    files: ["plugins/webhooks.spec.ts", "plugins/suinda/domain-webhook-events.spec.ts"],
    evidence: "receptor e resposta simulados; bloqueio de destinos privados também é testado",
  },
  {
    ids: ["32.12"],
    title: "Importação de liquidação com taxas, chargebacks e reconciliação",
    files: ["plugins/suinda/mercado-pago-settlement.spec.ts", "plugins/suinda-accounting.spec.ts", "plugins/financial-reconciliation-csv.spec.ts"],
    evidence: "arquivo/linhas de liquidação sintéticos; referência ambígua não altera saldo",
  },
  {
    ids: ["32.13"],
    title: "Contrato de exportação CRM e retirada de consentimento",
    files: ["plugins/suinda-crm.spec.ts"],
    evidence: "payloads de exemplo e saída limitada ao contrato vendor-neutral",
  },
  {
    ids: ["32.14"],
    title: "Lote contábil ERP, equilíbrio, reenvio e histórico imutável",
    files: ["plugins/suinda-accounting.spec.ts"],
    evidence: "plano de contas e lote sintéticos; receptor ERP externo não é contatado",
  },
  {
    ids: ["32.16"],
    title: "SSO corporativo e vinculação de conta com limites OIDC",
    files: ["access/access.spec.ts", "access/auth-lifecycle.spec.ts"],
    evidence: "contas e rotas de fixture; validação de tenant real permanece fora do cenário",
    coverage: "partial-fixture",
  },
  {
    ids: ["33.15", "33.16", "33.17", "33.18", "33.19"],
    title: "Recomendação, RAG autorizado, revisão docente e transcrição",
    files: ["plugins/suinda/learning-assistant.spec.ts", "plugins/ai/knowledge-retrieval.spec.ts", "plugins/suinda/suinda-transcription.spec.ts"],
    evidence: "embeddings, respostas e transcrições de fixture; sem chave ou modelo de IA externo",
  },
];
const supportingFiles = [
  "plugins/suinda-open-badges.spec.ts",
  "plugins/suinda/accessibility-audit.spec.ts",
];

const expectedIds = [
  "1.3", "1.4", "1.5", "1.6", "5.9", "6.2", "6.3", "6.4", "6.5", "12.4", "13.4",
  "15.6", "15.7", "15.8", "15.9", "15.10", "17.6", "17.7", "17.8", "21.11", "29.3",
  "30.6", "30.7", "32.2", "32.3", "32.4", "32.5", "32.6", "32.7", "32.9", "32.10",
  "32.11", "32.12", "32.13", "32.14", "32.16", "33.15", "33.16", "33.17", "33.18", "33.19",
];

function parseRange(value) {
  const match = /^(\d+)\.(\d+)(?:[–-](?:(\d+)\.)?(\d+))?$/.exec(value);
  if (!match) throw new Error(`Intervalo inválido no checklist externo: ${value}`);
  const [, areaText, firstText, endAreaText, endText] = match;
  const area = Number(areaText);
  const first = Number(firstText);
  const endArea = endAreaText === undefined ? area : Number(endAreaText);
  const last = endText === undefined ? first : Number(endText);
  if (endArea !== area || last < first) throw new Error(`Intervalo inválido no checklist externo: ${value}`);
  return Array.from({ length: last - first + 1 }, (_, index) => `${area}.${first + index}`);
}

function parseChecklistIds() {
  const ids = [];
  for (const line of readFileSync(externalChecklist, "utf8").split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const firstCell = line.split("|")[1] || "";
    for (const match of firstCell.matchAll(/`([^`]+)`/g)) ids.push(...parseRange(match[1]));
  }
  if (new Set(ids).size !== ids.length) throw new Error("A checklist externa contém IDs repetidos.");
  return ids.sort();
}

function validate() {
  const mapped = scenarios.flatMap((scenario) => scenario.ids);
  const duplicates = mapped.filter((id, index) => mapped.indexOf(id) !== index);
  if (duplicates.length) throw new Error(`IDs mapeados mais de uma vez: ${[...new Set(duplicates)].join(", ")}`);
  const expected = [...expectedIds].sort();
  const checklist = parseChecklistIds();
  if (expected.length !== 41 || new Set(expected).size !== expected.length)
    throw new Error("A lista fixa de IDs C deve conter 41 IDs únicos.");
  if (JSON.stringify(checklist) !== JSON.stringify(expected))
    throw new Error("A lista fixa dos 41 IDs diverge do checklist externo atual.");
  const missing = expected.filter((id) => !mapped.includes(id));
  const unexpected = mapped.filter((id) => !expected.includes(id));
  if (missing.length || unexpected.length)
    throw new Error(`Mapa de cenários divergente; ausentes=${missing.join(", ") || "—"}; extras=${unexpected.join(", ") || "—"}.`);

  const files = [...new Set([...scenarios.flatMap((scenario) => scenario.files), ...supportingFiles])].sort();
  const apiRoot = resolve(root, "apps/api/src");
  for (const file of files) {
    if (isAbsolute(file) || file.includes("\\")) throw new Error(`Caminho de spec inválido: ${file}`);
    const fullPath = resolve(apiRoot, file);
    const pathFromApi = relative(apiRoot, fullPath);
    if (pathFromApi === ".." || pathFromApi.startsWith(`..${sep}`) || isAbsolute(pathFromApi))
      throw new Error(`Spec fora de apps/api/src: ${file}`);
    if (!file.endsWith(".spec.ts") || file.includes(".integration.") || file.includes(".browser."))
      throw new Error(`Somente specs unitários .spec.ts são permitidos: ${file}`);
    if (!existsSync(fullPath)) throw new Error(`Spec mapeada não existe: ${file}`);
  }
  return files;
}

const files = validate();
const listOnly = process.argv.includes("--list");
const unknownArgs = process.argv.slice(2).filter((argument) => argument !== "--list");
if (unknownArgs.length) throw new Error(`Argumento não reconhecido: ${unknownArgs.join(" ")}`);

console.log("Cenários sintéticos locais; nenhum provedor real, banco ou serviço externo será contatado.");
console.log(`Requisitos externos mapeados: ${expectedIds.length}/41; specs unitárias: ${files.length}.`);
console.log("Specs adicionais para os parciais 31.9/32.15:", supportingFiles.join(", "));
console.log("Cobertura parcial de fixture:", scenarios.filter((scenario) => scenario.coverage === "partial-fixture").flatMap((scenario) => scenario.ids).join(", ") || "nenhuma");
for (const scenario of scenarios) console.log(`- ${scenario.ids.join(", ")}: ${scenario.title} [${scenario.evidence}]`);
if (listOnly) process.exit(0);

// Run fixture tests with an allow-listed process environment. In addition to
// dropping common secret names, this prevents newly added provider variables
// from making a local contract test contact a live service by accident.
const env = {
  PATH: process.env.PATH || "/usr/bin:/bin",
  HOME: process.env.HOME || "/tmp",
  TMPDIR: process.env.TMPDIR || "/tmp",
  TEMP: process.env.TEMP || "/tmp",
  TMP: process.env.TMP || "/tmp",
  LANG: process.env.LANG || "C.UTF-8",
  TZ: process.env.TZ || "UTC",
  NODE_ENV: "test",
  DOTENV_CONFIG_PATH: "/dev/null",
};

const tsx = resolve(root, "node_modules/tsx/dist/cli.mjs");
if (!existsSync(tsx)) throw new Error("Dependência local tsx ausente; instale as dependências do projeto antes da execução.");
const apiRoot = resolve(root, "apps/api");
const child = spawn(process.execPath, [tsx, "--test", "--test-concurrency=1", ...files.map((file) => resolve(apiRoot, "src", file))], {
  cwd: apiRoot,
  env,
  stdio: "inherit",
});
child.once("error", (error) => {
  console.error(`Não foi possível iniciar as specs sintéticas: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) console.error(`A validação sintética terminou pelo sinal ${signal}.`);
  process.exitCode = code ?? 1;
});
