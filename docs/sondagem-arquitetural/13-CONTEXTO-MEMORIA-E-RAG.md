# Contexto, memória e RAG

## Inventário de mecanismos

| Mecanismo | O que faz hoje | Relação com versão/frescor | Avaliação |
|---|---|---|---|
| Project Registry | Lê configuração `.orbit/orbit.yaml`, instruções/recursos cadastrados e calcula hashes de recursos | Hash detecta conteúdo de recurso observado, mas não fixa o HEAD completo do projeto nem revisão do card | Parcialmente equivalente a Project Context Registry (`execution/project-registry.ts:26-107`) |
| Context Builder de execução | Compõe contrato de arquitetura, card/config, agente/skills, regras/knowledge/arquivos/recursos vinculados e escopo | Guarda fingerprints dos recursos selecionados, sem proveniência global de commit | Parcialmente equivalente a Context Compiler (`execution/context-builder.ts:11-51`; `execution.service.ts:104-114`) |
| Prompt sessions | Compõe instrução de card, checklist, comentários, contexto vinculado, skills, anexos, permissões e checks | Prompt persistido; não captura revisão/HEAD. Execução mantém contexto obtido antes de enfileirar (`prompt-sessions.ts:413-517`) | Context compiler separado, parcial |
| Contexto de cards vinculados | Resolve relações de referência ao ler e informa que referências servem como contexto | Dinâmico, não snapshot versionado em si (`card-contexts.ts:7-32`) | Parcial |
| BM25 de desenvolvimento | Indexa chunks locais, reutiliza hash e pode filtrar fontes stale | SHA de arquivo/chunk local, indicador de staleness; sem garantia de integração a cada execução | Busca lexical local, não RAG runtime obrigatório (`tools/orbit/knowledge.mjs:146-235`; `docs/acceleration/knowledge.md:14-24`) |
| Vetores runtime | Serviço recebe candidatos autorizados do host, usa embeddings por hash e ranqueia similaridade cosseno | Candidatos e escopo são responsabilidade do chamador; migração não armazena referência a commit/revisão | RAG parcial, consumo produtivo não confirmado (`plugins/ai/knowledge-retrieval.ts:24-93`; migração `144_orbit_knowledge_embeddings.sql:1-12`) |
| Embeddings | Opt-in via env/chave e serviço externo de embeddings | Hash/modelo de embedding, não versão semântica de card/projeto | Parcial (`plugins/ai/embeddings.ts:3-37`) |
| Retenção | Expiração de embeddings após período definido | Retenção não equivale a reconciliação de validade | Implementado em escopo limitado (`plugins/ai/knowledge-retention.ts:4-39`) |

## Categorias conceituais

- **Project Context Registry — parcial:** há registro de projeto, recursos e fingerprints. Não há prova de manifesto unificado e imutável do contexto efetivamente entregue por run.
- **Context Compiler — parcial/duplicado:** prompt sessions e execução genérica compilam conjuntos diferentes. Não se encontrou contrato comum de seleção, precedência, tamanho e identidade de versão.
- **Project Consistency Engine — ausente de evidências:** project checks são comandos configurados por execução; não fazem reconciliação semântica de cards, docs e código (`execution.service.ts:118-133`).
- **Desired State Reconciler — ausente de evidências:** nenhum processo observado compara intenção vigente a estado observado e corrige divergência de forma contínua.
- **Versioned RAG — parcial:** hash/modelo e staleness de arquivo em busca local; vetores runtime com hash e candidatos autorizados. Não foi encontrado pin de Git SHA, revisão do card, autoria/validade por fonte ou descarte obrigatório de fonte obsoleta.
- **Knowledge Reconciliation — ausente de evidências:** não localizado fluxo que detecte contradição entre instruções, documentação, histórico de sessão e fonte de verdade do código.
- **Integration Gate — parcial:** write scope e checks podem bloquear/conter alterações; Git tem revisão de diff e stage. Não há prova de gate unificado para todas as filas e todos os commits (`execution/file-scope.ts:11-59`; `git.plugin.ts:145-199`).

## Riscos e limites da conclusão

Hashes detectam mudança de conteúdo em recursos específicos, mas não estabelecem que um conhecimento é atual, autorizado no momento de execução e válido para aquela versão do projeto. Uma sessão retomada é memória conversacional, não uma memória reconciliada. A instrução para inspecionar arquivos atuais é orientação útil, não mecanismo verificável de frescor.

## Testes e perguntas antes de evoluir

Testar atualização de arquivo-fonte após indexação BM25 e vetorial; conferir que resultados stale são removidos/rotulados e têm escopo correto. Verificar chamadas reais ao retrieval no fluxo de produção e se o host sempre fornece candidatos autorizados. Definir política de validade, proveniência, revisão/commit alvo, conflito entre fonte normativa e código, e retenção por produto/permissão. Não houve chamada de API nem inspeção de segredos.
