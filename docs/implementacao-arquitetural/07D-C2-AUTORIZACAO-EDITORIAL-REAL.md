# 07D-C2 — Autorização editorial transacional real

## Resultado e limite de conclusão

Implementada integração interna com o **AccessService real**, validada em PostgreSQL para escopos pessoais nativos e concessões explícitas. **Não está concluída a integração de todos os escopos dos produtos.** Workspaces, coleções e instâncias com providers de escopo/plugins permanecem indisponíveis no adapter; não se ignora a autorização adicional desses providers.

Nenhum endpoint/controller foi registrado. O host concreto devolve política ausente e não fornece resolver de evidência: `DiscoveryReviewApplication.decide` continua indisponível, inclusive quando o usuário possui permissões editoriais. Não há publicação, RAG, MCP, filas ou execução Codex nova.

## Arquivos

- Criado `packages/orbit-core/src/access/editorial-permissions.ts`: catálogo canônico de sete permissões.
- Criado `packages/orbit-core/src/execution/discovery-review-access-host.ts`: adapter real e delimitado.
- Alterado `packages/orbit-core/src/execution/discovery-review-application.ts`: distingue leitura de estado e de histórico no contexto confiável do autorizador.
- Alterado `packages/orbit-core/src/execution/discovery-review-repository.spec.ts`: testes SQL com AccessService real, além das regressões anteriores.
- Alterados os quatro `dev|prod|safdoulas|suinda/app/apps/api/src/access/access.ts`: avaliação explícita pela mesma conexão, catálogo, exceção ao bypass ROOT para permissões editoriais e exclusão dos defaults automáticos.
- Acrescentado `access/editorial-permissions.ts` nos quatro runtimes, com conteúdo idêntico à fonte canônica. Registrado esse único novo mapeamento em `orbit.workspace.json`, preservando os mapeamentos anteriores.
- Este relatório. Migration 210 e todas as migrations anteriores preservadas.

A revisão não foi ligada aos runtimes. As pequenas alterações comuns de AccessService foram reconciliadas nos quatro produtos; nenhuma versão/pacote foi publicada e nenhum processo foi reiniciado.

## Permissões e escopos

| Permissão | Operação |
|---|---|
| `discovery_review.current` | Estado atual |
| `discovery_review.history` | Histórico |
| `discovery_review.start_review` | Iniciar revisão |
| `discovery_review.request_information` | Pedir complementação |
| `discovery_review.approve` | Aprovar |
| `discovery_review.reject` | Rejeitar |
| `discovery_review.withdraw_approval` | Retirar aprovação |

São permissões do catálogo existente, utilizáveis por roles, grupos e exceções. Não há sistema paralelo de papéis. Não foram criadas concessões nem migração de dados. Defaults de usuário/administrador excluem essas permissões. O bypass ROOT de `has` não se aplica à família editorial; `hasScoped` a recusa enquanto os escopos não forem homologados.

A avaliação real usa grants globais explícitos, grupos, exceções allow/deny e permissões desativadas, reutilizando `effective`/`evaluatePermissions` do AccessService. ROOT também exige concessões explícitas; administrar acesso ou editar cards não concede aprovação.

O adapter exige adicionalmente `boards.read` e `projects.read`, propriedade atual do projeto e propriedade ou participação no board pessoal. Confere runtime e fila contra o capture; segue o card/list/board atual. Recusa workspace histórico ou atual, board fechado/coleção, card/lista arquivados e card no cofre. Esses filtros são restritivos; não representam autorização de compartilhamentos de projeto ou recursos de plugins.

## Identidade e segregação

A fábrica recebe somente identidade já autenticada pelo host: ator, sujeito efetivo, flag de simulação e versão da sessão. Não recebe body ou token como prova autônoma. O uso futuro deve ocorrer depois de `AccessService.authenticate`/AccessGuard, sem aceitar esses campos do cliente.

Dentro da transação, relê `users.disabled` e `session_version` e exige a versão autenticada. Simulação e divergência ator/sujeito são recusadas. Proponente é obtido de `discovery_journal_captures.actor_id`; autoaprovação é recusada. `reviewerId` continua derivado do ator na fachada, com rejeição de falsificação do body.

## Coordenação efetiva com revogações

Após o bloqueio por agregado da 07D-B, o adapter adquire `LOCK TABLE ... IN SHARE MODE` em ordem fixa para:

`users`, `access_roles`, `access_grants`, `access_groups`, `access_group_members`, `access_user_exceptions`, `access_permission_settings`, `boards`, `board_members`, `lists`, `cards`, `ai_projects`, `vault_items`.

Esse bloqueio é mantido até COMMIT/ROLLBACK. DML normal de revogação adquire automaticamente locks incompatíveis; não depende de writers adotarem um advisory lock novo. Cobre inclusive inserções de exceções deny e mudanças de membership que não existiam no snapshot, evitando o problema de bloquear somente linhas presentes.

Consultas executam pela conexão dedicada fornecida pelo repository, com READ COMMITTED. `AccessService.editorialPermissions` adapta `query/one` a essa conexão e reutiliza a avaliação existente sem chamar callbacks externos via pool. Não altera o `db` do singleton nem duplica integralmente RBAC.

Revogação que confirma antes do lock é observada pela consulta seguinte; mutação posterior espera a transação editorial terminar. Dois checks não são a garantia principal: o lock persiste entre eles. Revisão e duplicata são autorizadas antes de revelar histórico, e a decisão é reautorizada antes da inserção/retorno. CAS/idempotência permanecem na implementação anterior.

**Custo:** bloqueio de tabelas é abrangente e pode atrasar escritas ordinárias de usuários, boards e permissões durante a transação. Deadlocks com outros fluxos são possíveis e falham sem commit editorial. Não homologado para carga de produção; a fachada permanece desligada. Um protocolo mais granular demandaria integração de todos os writers, fora desta etapa.

## Caminhos cobertos e não cobertos

Cobertos por locks contra DML PostgreSQL normal: alteração/exclusão de grants e roles; edição de permissões de grupos; entrada/saída de grupos; allow/deny individual; desativação de permissão; suspensão/exclusão de conta e versão da sessão; mudanças nos vínculos pessoais usados na decisão. Sem reescrever esses caminhos existentes.

Não cobertos como autorização funcional: workspaces, organizações/federações, recursos compartilhados, coleções, providers de board/escopo e políticas externas ou mutáveis em memória. `editorialScopeProvidersPresent` recusa conservadoramente toda instância que registrou esses callbacks, mesmo quando uma callback talvez não afetasse aquele board. Os runtimes com plugins costumam registrar providers; não se declara que seus fluxos já estão habilitados.

Não há garantia contra superusuário desabilitando mecanismos do banco, decisões baseadas em sistemas externos, ou mudanças de registro de providers durante operação. O escopo comprovado é o AccessService nativo sem providers ativos, sob modelo de configuração estável. Nenhum bypass operacional foi instalado para contornar esses limites.

## Auditoria

Reutiliza `access_audit` e seu esquema real, pela mesma conexão: ator, ação/permissão, UUID da descoberta e escopo `project`. Sem motivos, textos editoriais ou evidências na auditoria. Auditoria de sucesso é confirmada com a operação; rechecagens podem produzir mais de uma linha de auditoria.

Recusas abortam a transação. Não se afirma que uma auditoria de recusa nessa transação sobreviveria ao rollback. Registro independente de recusas permanece pendente; não foi criada infraestrutura adicional.

## Testes e evidências

Node 24.20.0, TSX e PostgreSQL 16 descartável por socket Unix, sem Docker ou bancos existentes:

- Execução conjunta 07D-A/B/C/C2: **41 aprovados, zero falhas** na primeira versão.
- Após reforços de ROOT, escopo e testes adicionais, reexecutado somente o arquivo afetado: **34 aprovados, zero falhas**, incluindo oito cenários C2. Os nove testes 07D-A passaram na execução conjunta anterior e seus arquivos não foram alterados.
- Teste adicional `dev/app/apps/api/src/access/access.spec.ts`: **23 aprovados, uma falha preexistente**. O teste de simulação exige `sessionUser`/`me.id` iguais ao ROOT, mas o código retorna identidade demonstrativa. A incompatibilidade aparece também em `git show HEAD` tanto no teste quanto em `AccessGuard`/`me`; não foi introduzida ou corrigida aqui.
- `git diff --check` dos quatro AccessService: sem erros.

Os testes C2 instanciam o **AccessService de DEV real**, sem mock de avaliação de permissões. Aplicam migrations reais 065, 068, 070 e 096 sobre tabelas-base mínimas, além de 209/210. Validam ROOT sem concessão, grants via grupos reais, auditoria, decisão com concessão explícita, bloqueio concorrente de alteração de role/grupo/membership, deny após revogação contra duplicata, versão de sessão, runtime errado, ausência de adapter de plugin, distinção current/history, simulação e autoaprovação.

As políticas/compatibilidades positivas usadas pelos testes do repository são fixtures explícitas, não configuração de produção. A fábrica concreta mantém os comandos indisponíveis. Não aplicada toda a cadeia histórica dos produtos: esquema-base de escopo foi limitado às colunas utilizadas; não se declara homologação de atualização integral ou dos quatro runtimes. Não foram executadas suítes globais nem TypeScript global dos quatro produtos.

Comando principal:

```sh
TSX_TSCONFIG_PATH=dev/app/apps/api/tsconfig.json TSX_DISABLE_CACHE=1 \
 node --import ./dev/app/node_modules/tsx/dist/loader.mjs --test \
 packages/orbit-core/src/execution/discovery-review-repository.spec.ts \
 packages/orbit-core/src/execution/discovery-review.spec.ts
```

## Bloqueios restantes

Antes de HTTP: integrar sessão confiável à fábrica, homologar adapters dos escopos/plugins reais e seus writers de revogação, validar carga/ordem de locks e cadeia histórica completa. Definir política editorial confiável/versionada e avaliação autorizada atual de evidências. Não inventados nesta entrega.

Sem fontes de política/evidência, comandos permanecem bloqueados. Sem homologação dos providers, seus escopos permanecem bloqueados mesmo para consultas. Nenhum controller, interface, publicação ou 07D-D foi criado.

`main` e HEAD `d9307b8e6a54316f802acbd7bcb96baa26116f16` preservados; trabalho anterior não commitado mantido. Sem limpeza da árvore, commit, push, deploy ou alteração de bancos reais.
