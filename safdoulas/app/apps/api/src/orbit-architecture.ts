import { HttpException } from '@nestjs/common';

// This is the public mutation contract, not the database row shape.
export const orbitArchitecture = {
  version: 1,
  reference: 'Orbit',
  checklistPerCard: 1,
  cardInterface: {
    execution: 'prompt-runs',
    contexts: 'card-contexts',
    contextHierarchy: 'primary-parent-tree-with-independent-contexts',
    obsoletePanels: ['Execução opcional', 'Contexto', 'Limites de alteração', 'Integrações'],
    executionConfiguration: 'backend',
  },
  cardAiModes: { bypass: 'Permissivo', planning: 'Planejamento', question: 'Questionar' },
  promptRunAnswer: ['answer'],
  promptRunExecute: ['instruction', 'multiple_agents'],
  promptWaitingStatus: 'waiting_answer',
  cardPlugins: {endpoint:'/cards/:id/plugins',selection:['plugins'],fieldsEndpoint:'/cards/:id/plugins/:pluginId/fields',default:'basic',contribution:'cardLayouts',dependencies:true},
  cardCreate: ['title', 'position', 'card_type_id'],
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
Quadro contém listas; lista contém cartões simples. Cartão tem título e descrição Markdown, uma única checklist e vínculos em Contextos. Contextos são referências vivas, não descrições copiadas. Módulos e demandas são cartões normais, derivados de itens de checklist pela conversão nativa. Cada cartão usado como contexto é pai do cartão que o referencia. A conversão de checklist cria um cartão filho e herda o pai e seus contextos. A hierarquia visual usa o contexto mais próximo como pai imediato e mantém os ancestrais herdados como referências vivas. Use o fluxo de listas do quadro de referência; não crie uma lista por módulo.
Configuração de IA, skills, executor, permissões e projeto usam os campos de configuração existentes. Não transforme instruções ou entregáveis em novos campos personalizados. Em quadros com referência configurada, os campos personalizados são limitados aos da referência.
Recursos de IA e desenvolvimento pertencem a plugins desacoplados. Configure layouts em /cards/:id/plugins usando apenas plugins declarados no catálogo. Desenvolvimento depende de IA; um cartão básico não possui IA. Campos específicos de plugins usam somente o contrato de cardLayouts, nunca campos inventados no card. Na interface do cartão, quando o plugin de IA estiver selecionado e ativo, use IA do cartão, Contextos com vínculos vivos e o histórico de prompt-runs na aba Execução. Os painéis antigos Execução opcional, Contexto, Limites de alteração e Integrações foram retirados. Configurar uma execução pela API não autoriza renderizar esses painéis; escopo de arquivos e verificações obrigatórias são configurações internas do backend.
Use a API autenticada e seu contrato para alterações no Orbit. Não altere diretamente o banco, schema ou interface do Orbit como parte de uma tarefa de outro projeto.
Preserve a identidade visual, layout e arquitetura do projeto selecionado. Mudanças de conteúdo devem ser integradas nos componentes existentes. Não publique relatórios internos, roteiros de teste, pendências editoriais ou artefatos de execução em páginas comerciais. Faça alterações pequenas, execute verificações reais e só declare aceites comprovados. Não faça commit, push, deploy ou ações de ciclo de vida sem autorização específica.
Identidade e operação dos produtos Orbit seguem o contrato persistente: leia AGENTS.md, docs/product-experience.md e as skills aplicáveis antes de criar ou reorganizar uma experiência. Padronize shell, navegação, permissões, workspaces e interações com o Orbit; adapte linguagem, tarefas e identidade ao domínio do produto. Não exponha a estrutura técnica dos plugins como menu principal nem crie fluxos concorrentes.
Simulação de perfil ROOT nunca é somente troca de permissões: preserve a sessão/token e a identidade real de auditoria do ROOT, mas associe a requisição a uma persona e a dados de demonstração isolados do runtime e do produto. O contexto precisa existir para todos os papéis do catálogo, inclusive papéis novos; personas não autenticam, não expõem dados reais e rotas sem fixtures isoladas falham fechadas; até que a escrita simulada isolada exista, o contexto permanece somente leitura, sem efeitos externos. Contexto genérico pertence ao core e fixtures de domínio contribuem por plugins compatíveis. Ao gerar um produto novo, preserve esse contrato na aplicação e na documentação gerada e exija cobertura de contexto para todos os papéis, inclusive os declarados pelos plugins. Leia o contrato de simulação em docs/product-experience.md.
Orbit DEV é o ponto de integração para validar em conjunto plugins, contratos, dependências, permissões, eventos, schemas, versões e referências de core. Reconcilie mudanças comuns em DEV e projete-as nos runtimes aplicáveis, preservando diferenças intencionais e isolamento de configuração, serviços, bancos e dados. DEV não autoriza publicação.
Estas orientações persistentes também devem chegar ao painel Codex incorporado e às execuções de cartão: ao alterar ou criar instruções de arquitetura, produto ou fluxo para Orbit, sincronize a regra no AGENTS.md, docs/product-experience.md, skills aplicáveis e neste contrato injetado como developerInstructions do Codex IDE e contexto das execuções. Não considere a edição documental completa enquanto os canais de execução estiverem desatualizados.`;
