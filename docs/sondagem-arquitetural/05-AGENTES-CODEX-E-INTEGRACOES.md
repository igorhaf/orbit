# Agentes, Codex e integrações

## Dois caminhos de IA

| Caminho | Finalidade | Dados/estados | Executor |
| --- | --- | --- | --- |
| Prompt assistido do cartão | alterar/gerar conteúdo de projeto com contexto do cartão | `card_ai_runs`, sessões Codex e histórico limitado | `CodexAiService` / Codex CLI |
| Execução configurada por cartão | executar action configurada de executor ou plugin | `card_execution_configs`, `card_runs`, logs e outputs | `CodexExecutor`, `PluginActionExecutor` |

Rotas de prompt estão no módulo AI; rotas de execução em `execution/execution.controller.ts:9-14`. Os fluxos têm filas/estado próprios e não devem ser tratados como um serviço único sem uma análise de integração adicional.

## O que “agente” significa no código encontrado

`ProjectRegistry`, `AgentRegistry` e `SkillRegistry` leem documentos de projeto. Agentes podem declarar skills/rules/knowledge e executor/action; recursos têm metadados validados e hash (`execution/project-registry.ts:26-107`). Não foi localizada entidade de agente no banco, serviço de identidade/registro global, supervisor de agentes, ou persistência de mensagens/filhos.

Portanto, a evidência suporta **configuração de agentes como recursos/instruções de projeto**. Não suporta a afirmação de que o Orbit mantém um runtime próprio que agenda e supervisiona agentes autônomos independentes.

## Integração Codex

O Codex é iniciado como processo local usando CLI, com timeout, diretório home isolado, saída coletada e possibilidade de abortar o processo (`execution/codex-executor.ts:10-43`, `plugins/ai/codex-provider.ts:120-130`). O provedor de prompt injeta `orbitArchitecturePrompt` (`codex-provider.ts:130`; `orbit-architecture.ts:38-48`). Sessões Codex podem ser registradas e retomadas por ID; fallback pode criar nova sessão se a antiga não puder ser retomada.

Não foi observada integração por serviço Codex remoto/SDK no caminho principal de execução descrito. A superfície real depende da versão e disponibilidade do binário/configuração local; a sondagem não iniciou o binário.

## Múltiplos agentes

`multiple_agents` é validado, armazenado na run e enviado como opção nativa multi-agent do Codex (`prompt-sessions.ts:37,413-416,482`; `codex-provider.ts:120-128`). O contrato instrui delegação/avaliação, mas não houve evidência de tabela para subruns, tokens por agente, ferramenta de comunicação, permissões refinadas por filho ou comprovação de que uma execução marcada criou subagentes.

**Classificação:** mecanismo de solicitação/sinalização parcial; orquestração gerenciada e observável pelo Orbit não localizada.

## Contexto e conhecimento

Contexto de execução é montado por projeto com documentos e escopo de arquivos (`execution/context-builder.ts:11-51`). Há uma ferramenta local `tools/orbit/knowledge.mjs` baseada em BM25 que indexa fontes locais e expõe caminhos/linhas/hash/stale. Separadamente, o plugin AI contém embedding provider, armazenamento vetorial e `OrbitKnowledgeRetrievalService`. Essa classe recebe candidatos já autorizados e não faz autorização em nome do plugin host (`plugins/ai/ai.plugin.ts` comentário e export; `knowledge-retrieval.ts`). Não foi localizada inclusão automática do resultado de RAG em todos os prompts de cartão.

## Integrações externas

Há plugins/adapters para GitHub, Git, Google, Drive, calendários Microsoft/Google, e-mail, Dropbox, Alexa, Cloudflare Tunnel e outros. Os contratos oferecem provedores de conexão/actions e o registry valida capabilities, dependências, schemas e permissões. A presença de código não confirma conta conectada, webhook público, quota disponível ou fluxo externo bem-sucedido.

## Testes localizados, não executados

- `execution.spec.ts`, `execution.integration.spec.ts`, `execution.browser.spec.ts`.
- `src/prompt-question.spec.ts` e `plugins/ai/knowledge-retrieval.spec.ts`, além de testes de sessions.
- `plugins/sdk.spec.ts`, `plugins/core-compatibility.spec.ts`, `plugins/contract.spec.ts`.
- Integrações externas possuem unit/integration specs, mas nenhuma foi executada nesta sondagem.

## Perguntas arquiteturais relevantes

1. A caixa “Múltiplos agentes” é solicitação best effort ou requisito de delegação comprovável?
2. Quais dados de cada subagente devem persistir (identidade, prompt, custo, ferramentas, arquivos, estado, retorno)?
3. Devem existir agentes globais, por workspace, por projeto, por cartão ou composição destes níveis?
4. Quem pode criar/alterar agentes e aprovar permissões ou arquivos que um agente pode editar?
5. O RAG deve ser uma capability transversal do Orbit ou continuar sendo uma ferramenta opt-in chamada por plugins que passam candidatos autorizados?
