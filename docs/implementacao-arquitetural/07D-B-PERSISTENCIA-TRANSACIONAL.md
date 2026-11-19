# 07D-B — Persistência transacional do Discovery Review

## Entrega e arquivos

- `packages/orbit-core/sql/migrations/210_discovery_review.sql`: próxima migration disponível na fonte canônica.
- `packages/orbit-core/src/execution/discovery-review-repository.ts`: registro atômico, estado atual e histórico ordenado.
- `packages/orbit-core/src/execution/discovery-review-repository.spec.ts`: validação operacional em PostgreSQL descartável.
- Este relatório. Nenhum arquivo de etapas anteriores foi modificado.

## Histórico e integridade

`discovery_review_decisions` é a única fonte de verdade editorial. Não existe tabela paralela de estado corrente. O estado inicial é `proposed`, revisão zero; o estado posterior é reconstruído da última decisão persistida.

Cada linha contém descoberta, fila, revisão esperada/resultante, ação, estado resultante, chave idempotente, hash, comando original e decisão versionada. A decisão contém autor atribuído, motivo, complementação e timestamp ISO canônico. `persisted_at` registra separadamente o instante observado pelo banco.

A chave primária é `(discovery_id, review_revision)`; a unicidade idempotente é `(discovery_id, idempotency_key)`, independentemente do revisor. A descoberta identifica um agregado único e sua fila é conferida contra o capture da 07C. FK com `ON DELETE RESTRICT`; sem cascata de exclusão.

Triggers recusam UPDATE, DELETE e TRUNCATE. Outro trigger valida a sequência de revisões, transições, correspondência entre comando/decisão, hash canônico e condições de aprovação. A política e a avaliação histórica de compatibilidade são entradas da decisão, nunca elegibilidade persistida.

Não há limpeza automática. Retenção exige política administrativa explícita e implementação futura autorizada. Proprietários/superusuários podem contornar triggers: estas garantias não constituem proteção contra administradores do banco.

## Transação e concorrência

Cada operação adquire conexão dedicada do pool e executa `BEGIN ISOLATION LEVEL READ COMMITTED`. Não usa BEGIN/COMMIT em um cliente multiplexado.

O agregado é serializado por advisory lock transacional `discovery-review:<UUID>` antes da leitura do histórico. O trigger de inserção usa o mesmo protocolo. Colisões do hash apenas ampliam serialização; não ampliam acesso.

Após adquirir o bloqueio, o repository consulta o histórico, encontra a chave idempotente e reutiliza `resolveDiscoveryReviewRetry` da 07D-A. Solicitação repetida retorna a decisão original, mesmo com CAS antigo e decisões posteriores; conteúdo divergente produz `review_idempotency_conflict`. Outra chave exige revisão atual e transição válida. CAS divergente retorna `review_conflict`.

A inserção e o COMMIT encerram a operação. Erros executam ROLLBACK e liberam a conexão. Chaves primárias/únicas e o guard SQL complementam a validação em memória. A unicidade da revisão também impede que escritores registrem duas decisões para a mesma revisão.

As consultas de estado e histórico também usam o bloqueio para obter uma visão consistente do agregado. O histórico é ordenado por revisão, sem depender da ordem de timestamps atribuídos.

## Compatibilidade, política e fronteira do host

A 07C fornece referências históricas, não avaliação atual autorizada de compatibilidade. Um `DiscoveryReviewEvidenceResolver` explícito recebe origem e conexão transacional; ausência dessa resolução resulta em `unassessed`. O repository não infere compatibilidade positiva de hashes ou evidências antigas.

Estado editorial, avaliação de evidência e política permanecem separados. A elegibilidade é recalculada na leitura/retorno com avaliação atual e política fornecida, sem coluna que autorize publicação. Avaliação ausente mantém inelegibilidade e impede aprovação conforme a 07D-A. Falha do resolver aborta a operação.

Mudanças posteriores na avaliação não alteram decisões anteriores. O resultado de duplicata contém a decisão original e o snapshot atual recalculado, que pode diferir do snapshot retornado originalmente.

O resolver é uma fronteira interna de confiança do host, não um mecanismo de autenticação. IDs de descoberta/fila e `reviewerId` não concedem acesso. Esta camada não deve ser exposta diretamente a clientes sem autorização futura. Avaliação de arquivos externos não ganha atomicidade com o PostgreSQL por receber uma conexão; a fonte e sua validade precisam ser definidas pelo host.

## Testes executados

Comando (Node 24.20.0):

```sh
TSX_TSCONFIG_PATH=dev/app/apps/api/tsconfig.json TSX_DISABLE_CACHE=1 \
 node --import ./dev/app/node_modules/tsx/dist/loader.mjs --test \
 packages/orbit-core/src/execution/discovery-review-repository.spec.ts \
 packages/orbit-core/src/execution/discovery-review.spec.ts
```

Primeira execução: 23 testes aprovados, zero falhas/ignorados (13 cenários SQL, um teste contêiner e nove testes 07D-A). Após reforço dos checks SQL de tipos/política e normalização do UUID, reexecutado somente o arquivo afetado: 14 testes aprovados, zero falhas/ignorados.

Cobertura: estado inicial; primeira transição; histórico e incremento; duplicata antiga; conflito de chave; CAS obsoleto; concorrência com chaves diferentes; duplicatas concorrentes; rollback após falha injetada em AFTER INSERT; bloqueio de UPDATE/DELETE/TRUNCATE/exclusão da descoberta; reconexão; compatibilidade ausente/alterada; tentativa de revisão inválida diretamente em SQL. Exercitadas origens `card_runs` e `card_ai_runs`.

O teste cria cluster PostgreSQL 16 temporário em socket Unix privado, sem TCP e sem Docker. Aplica as migrations 209 e 210 originais sobre fixtures mínimas de tabelas predecessoras, e captura propostas pelo repository 07C. Não equivale a aplicar toda a cadeia histórica de migrations. O cluster temporário é encerrado ao final. Nenhum banco de ambiente foi utilizado.

## Limitações e próximas etapas

- 07D-C/07D-D: definir identidade autenticada, permissões, reautorização transacional, segregação de funções e acesso por escopo do produto antes de qualquer exposição.
- Definir a fonte autorizada e versionada de avaliação das evidências e governança da política editorial.
- Planejar aplicação da migration e distribuição de projeções somente em etapa autorizada; não foram executadas nesta entrega.
- Consultas carregam o histórico completo do agregado; paginação/otimização poderá ser necessária para agregados extensos.
- Publicação e qualquer efeito sobre conhecimento exigem fluxo próprio posterior; aprovação editorial não os executa.
- Sem API, interface, MCP, RAG, autenticação fictícia, novas integrações de filas ou alteração do executor/Codex.

Branch `main`, HEAD `d9307b8e6a54316f802acbd7bcb96baa26116f16` preservados. A árvore já possuía 450 entradas de alterações/arquivos não rastreados antes da etapa. O trabalho preexistente foi preservado; foram acrescentados somente os quatro arquivos desta entrega. Sem commit, push, deploy ou publicação de projeções. 07D-C e 07D-D não foram iniciadas.
