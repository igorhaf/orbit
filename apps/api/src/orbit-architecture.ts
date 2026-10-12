import { HttpException } from '@nestjs/common';

// This is the public mutation contract, not the database row shape.
export const orbitArchitecture = {
  version: 1,
  reference: 'Orbit',
  checklistPerCard: 1,
  cardInterface: {
    execution: 'prompt-runs',
    contexts: 'card-contexts',
    obsoletePanels: ['Execução opcional', 'Contexto', 'Limites de alteração', 'Integrações'],
    executionConfiguration: 'backend',
  },
  cardAiModes: { bypass: 'Permissivo', planning: 'Planejamento', question: 'Questionar' },
  promptRunAnswer: ['answer'],
  promptWaitingStatus: 'waiting_answer',
  cardCreate: ['title', 'position'],
  cardUpdate: ['title', 'description', 'list_id', 'position', 'kind', 'target_board_id', 'link_url', 'mirror_expanded', 'start_date', 'due_date', 'reminder_minutes', 'recurrence', 'schedule', 'schedule_start_at', 'schedule_end_at', 'schedule_all_day', 'schedule_time_zone'],
  boardCreate: ['title', 'background', 'workspace_id'],
  listCreate: ['title', 'position', 'parent_list_id'],
  checklistCreate: ['title', 'source_id'],
  checklistItemCreate: ['text'],
  checklistConvert: ['list_id'],
  contexts: ['ids'],
  executionContext: ['knowledge','rules','cards','files','instructions','include_agents_md','write_scope'],
} as const;

export function assertOrbitFields(input: unknown, allowed: readonly string[]) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpException('Informe um objeto válido.', 400);
  const unknown = Object.keys(input).filter(key => !allowed.includes(key));
  if (unknown.length) throw new HttpException({ message: `Campos fora da arquitetura do Orbit: ${unknown.join(', ')}. Campos aceitos: ${allowed.join(', ')}.` }, 400);
}

export const orbitArchitecturePrompt = `CONTRATO OBRIGATÓRIO DE ARQUITETURA ORBIT (versão 1):
O projeto Orbit é a referência de arquitetura de quadros e orquestração. Consulte sua implementação atual e o contrato da API antes de criar estruturas. Não invente campos, formulários, estados, componentes ou recursos do produto. Não reproduza interfaces antigas.
Quadro contém listas; lista contém cartões simples. Cartão tem título e descrição Markdown, uma única checklist e vínculos em Contextos. Contextos são referências vivas, não descrições copiadas. Módulos e demandas são cartões normais, derivados de itens de checklist pela conversão nativa. A conversão herda o pai e seus contextos. Use o fluxo de listas do quadro de referência; não crie uma lista por módulo.
Configuração de IA, skills, executor, permissões e projeto usam os campos de configuração existentes. Não transforme instruções ou entregáveis em novos campos personalizados. Em quadros com referência configurada, os campos personalizados são limitados aos da referência.
Na interface do cartão, use IA do cartão, Contextos com vínculos vivos e o histórico de prompt-runs na aba Execução. Os painéis antigos Execução opcional, Contexto, Limites de alteração e Integrações foram retirados. Configurar uma execução pela API não autoriza renderizar esses painéis; escopo de arquivos e verificações obrigatórias são configurações internas do backend.
Use a API autenticada e seu contrato para alterações no Orbit. Não altere diretamente o banco, schema ou interface do Orbit como parte de uma tarefa de outro projeto.
Preserve a identidade visual, layout e arquitetura do projeto selecionado. Mudanças de conteúdo devem ser integradas nos componentes existentes. Não publique relatórios internos, roteiros de teste, pendências editoriais ou artefatos de execução em páginas comerciais. Faça alterações pequenas, execute verificações reais e só declare aceites comprovados. Não faça commit, push, deploy ou ações de ciclo de vida sem autorização específica.`;
