# Matriz de cards, versões e execuções

## Escopo e confiança

Leitura estática do runtime DEV. Os caminhos abaixo são relativos à raiz do monorepo. Não foram executados testes nem chamadas de runtime nesta sondagem. “Não encontrado” significa que não foi localizado nas partes examinadas, não uma prova universal de inexistência.

## Relações observadas

| Entidade | O que persiste | Relação com estado anterior/seguinte | Evidência e limite |
|---|---|---|---|
| Card | `id`, título, descrição, `updated_at` e demais campos operacionais | A edição atualiza o mesmo registro. Não foi encontrado número de revisão nem snapshot do texto | `dev/app/apps/api/sql/schema.sql:103-114`; `dev/app/apps/api/src/main.ts:881-963` |
| Execução de card (`card_runs`) | Entrada/configuração serializada, status, resultado e cadeia | Enfileiramento conserva snapshot de card/config; `chain` existe, mas consumidor não foi localizado | `dev/app/apps/api/src/execution/run-repository.ts:10-18`; confirmar schema/migração em `dev/app/apps/api/sql/migrations/001_executable_cards.sql:1-49` |
| Execução de prompt (`card_ai_runs`) | Prompt montado, modelo/esforço, flag multiagente, sessão, saída, resumo, arquivos/eventos e status | Cada execução aponta ao card; não guarda revisão do card ou SHA do projeto. Card excluído apaga por cascata os runs relacionados | `dev/app/apps/api/sql/schema.sql:426-450` |
| Sessão Codex | `codex_session_id` no run | Ao continuar, a sessão anterior do mesmo card/projeto pode ser retomada; não há vínculo observado a revisão de card/commit | `dev/app/apps/api/src/plugins/ai/prompt-sessions.ts:447-471,490-517`; `codex-provider.ts:120-130,172-184` |
| Prompt | Texto final compilado, guardado em `card_ai_runs.prompt` | É montado antes do enfileiramento. Worker fecha sobre o contexto carregado; edição posterior não atualiza esse prompt | `dev/app/apps/api/src/plugins/ai/prompt-sessions.ts:413-485,486-517` |
| Arquivos alterados | Lista/eventos e diff de revisão | Permite atribuição aproximada ao run; diffs Git são coletados após a CLI. Não prova autoria exclusiva em diretório compartilhado | `dev/app/apps/api/src/plugins/ai/codex-provider.ts:186-216,250-271`; `schema.sql:439-440` |
| Commit associado ao card | SHA, branch, título, arquivos, ação e alvo de undo/redo | Associação é criada pelo fluxo Git de commit; execução bem-sucedida não é commit automático | `dev/app/apps/api/sql/schema.sql:562-582`; `dev/app/apps/api/src/git/git.plugin.ts:189-216` |
| Projeto | Diretório local registrado e configurações/contexto | Contexto pode incluir arquivos de instrução e recursos com hashes, mas não há snapshot global do HEAD por execução | `dev/app/apps/api/src/execution/project-registry.ts:26-107`; `context-builder.ts:11-51` |

## Ciclo resumido

1. Prompt de IA lê card e dados associados, compõe o texto e insere run `queued` (`prompt-sessions.ts:413-485`).
2. Worker serializa operações do subsistema de prompts por card e caminho de projeto e usa o objeto de card capturado para iniciar (`prompt-sessions.ts:486-517`).
3. Codex executa/resume a sessão e devolve eventos, saída, session ID e alterações de arquivo (`codex-provider.ts:118-130,172-233`).
4. Orbit persiste resultado e status; não cria commit (`prompt-sessions.ts:549-568`). Commit requer fluxo explícito de revisão/stage/commit (`git.plugin.ts:145-199`).
5. Execução genérica de card é uma fila separada, com `run.input` de snapshot e claim via banco (`run-repository.ts:10-18`).

## O que o modelo atual permite afirmar

- **Fato:** card, prompt e execução são conceitos distintos na persistência, mas falta uma revisão imutável que conecte a versão do card ao run.
- **Fato:** o texto de prompt armazenado funciona como registro do que foi enviado naquele run; não equivale a uma revisão formal do card.
- **Fato:** `updated_at` é atualizado na edição, porém não há comparação dessa marca antes de executar ou aceitar resultado.
- **Fato:** associação card↔commit existe quando o commit passa pelo fluxo Git Orbit; não é universal para commits externos ou alterações de execução ainda não integradas.
- **Inferência:** a lista de arquivos do run pode sugerir quais arquivos revisar ao retomar um card, mas a atribuição fica ambígua se houver alterações concorrentes no mesmo worktree.
- **Não verificado:** se todo commit do repositório é sempre registrado pelo plugin Orbit, e se o campo `chain` tem consumidor em módulos fora do escopo pesquisado.

## Riscos para versionamento

Sem revisão explícita, “card vigente”, “prompt enfileirado” e “sessão continuada” podem representar intenções diferentes. Sem pin de `HEAD`, também não fica demonstrado qual base de código foi lida. O registro de prompt e a sessão recuperável ajudam na auditoria parcial, mas não fecham a identidade do contexto executado.

## Verificações futuras recomendadas

Criar testes de integração para editar card antes do claim, durante execução e antes da conclusão; verificar qual prompt foi enviado e se resultado de versão antiga pode ser aceito. Testar associação de commits externos, exclusão de card com histórico Git e retomada de sessão após mudança no card/HEAD. Nenhum desses testes foi executado nesta sondagem.
