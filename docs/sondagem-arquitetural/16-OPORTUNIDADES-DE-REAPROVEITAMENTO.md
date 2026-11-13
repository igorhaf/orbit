# Oportunidades de reaproveitamento

Este relatório identifica capacidades existentes que poderiam contribuir para uma evolução. Não recomenda refatoração completa nem implementa mudanças. Evidências são do código DEV; compatibilidade runtime deve ser confirmada separadamente.

| Necessidade investigada | Componente reaproveitável | Cobertura atual | Limite a respeitar |
|---|---|---|---|
| Identificar projetos e recursos | Project Registry (`execution/project-registry.ts:26-107`) | Config, instruções, recursos e hashes | Não é snapshot global de HEAD/revisão de card |
| Montar contexto de execução | Context Builder (`execution/context-builder.ts:11-51`) | Junta fontes selecionadas, escopo e recursos | Há segundo compilador em `prompt-sessions.ts:426-471`; unificação/compatibilidade não comprovada |
| Manter execução dentro do escopo | `captureFileScope` e project checks (`execution/file-scope.ts:11-59`; `execution.service.ts:118-133`; `codex-provider.ts:51-69`) | Detecta escrita fora de escopo, restaura e valida comandos configurados | Não usar como isolamento de processos concorrentes: snapshot/restore compartilha árvore |
| Evitar claim duplicado | RunRepository (`execution/run-repository.ts:10-18`) | Transação e `SKIP LOCKED` para fila card_runs | Não modela dependências; não sincroniza com fila prompt nem isola worktree |
| Serializar prompts por projeto/card | Advisory locks (`prompt-sessions.ts:490-507`) | Evita sobreposição interna nessa trilha | Não presumir lock comum com outras trilhas/processos que não usem o mesmo protocolo |
| Retomar contexto conversacional | `codex_session_id` e provider resume (`schema.sql:436`; `codex-provider.ts:120-130,172-184`) | Continuidade de sessão com fallback para nova sessão | Não substitui snapshot de requisito nem política de staleness |
| Entender trabalho realizado | Eventos, output, resumo e file changes (`schema.sql:437-440`; `codex-provider.ts:72-94,186-233`) | Evidência útil para UI e revisão | Lista/diff não prova autoria quando worktree é compartilhado |
| Recuperar conhecimento lexical | Ferramenta BM25 (`tools/orbit/knowledge.mjs:146-235`) | Hash, stale e filtro `--fresh` | Local e separado do caminho automático do prompt; não tem proveniência por commit/revisão do card |
| Buscar conhecimento vetorial | `OrbitKnowledgeRetrievalService` (`plugins/ai/knowledge-retrieval.ts:24-93`) | Escopo por workspace/plugin/coleção e ranking de candidatos autorizados | Host fornece candidatos; uso produtivo obrigatório não foi localizado; não fixa revisão do projeto |
| Revisar/registrar integração | Git plugin (`git.plugin.ts:145-199`) | ETag de diff, stage seletivo, confirmação do conjunto esperado, associação card/commit | Cobre fluxo Orbit; commits externos e semântica entre cards não são garantidos |
| Reverter alteração integrada | Undo/redo de commit (`git.plugin.ts:201-216`) | `git revert` com registro de ação e SHA-alvo | Requer branch original e árvore limpa; conflito/dependências exigem análise |
| Manter experiência de pergunta | Question marker + API/resume + progress events (`prompt-question.ts:4-15`; `prompt-sessions.ts:538-546`; `orbit-events.ts:17-19`) | Usuário pode responder durante modo de pergunta | Não é canal de ferramenta/RPC agente-Orbit |
| Validar plugins e contratos comuns | Contract/registry/compatibility checks documentados em `09-INDICE-DE-EVIDENCIAS.md` | Dependências, contratos e compatibilidade estrutural | Não equivale a consistência funcional de tarefas ou regras de negócio em execução |

## O que dá para compor sem duplicar responsabilidade

- Usar Project Registry e os builders existentes como fontes de contexto, preservando os dois caminhos até que seu escopo e diferenças sejam verificados.
- Tratar fingerprints de recurso e hashes BM25 como sinais de frescor, sem promovê-los a prova de versão do projeto.
- Reaproveitar captura de escopo e checks como controles locais, adicionando testes de concorrência antes de confiar neles com múltiplos writers.
- Usar run artifacts e commits associados como trilha de auditoria parcial, reconhecendo que card hard-delete remove a associação por cascata.
- Reaproveitar gate Git existente para revisão, sem confundi-lo com gate global para execução ou consistência semântica.

## Responsabilidades sem equivalente comprovado

Na árvore examinada, não foi encontrada evidência de mecanismo único que vincule revisão do card, prompt/contexto, sessão Codex, base HEAD, arquivos e commit; reconcilie intenção com estado efetivo; detecte dependências entre cards; ou coordene concorrência entre as duas filas. Essas são lacunas candidatas a decisão de arquitetura, não autorização para implementar componentes antes de responder ao questionário.
