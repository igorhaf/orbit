# 07D-C4 — Escopos, providers e concorrência

## Resultado

Inventariados os providers relevantes e demonstrados os custos/riscos do protocolo existente. Incorporada uma correção conservadora: a detecção de providers não homologados passa a incluir callbacks de recursos, registros e listagens e os providers adicionais do Suindá. **Nenhum provider foi homologado ou habilitado para revisão editorial.** Produção, endpoints e comandos continuam desabilitados.

Não há evidência suficiente para substituir os locks de tabelas por locks de linhas/advisory locks sem alterar os writers existentes. O protocolo transacional foi mantido integralmente.

## Providers e diferenças por runtime

Inspeção dirigida às classes AccessService, WorkspacesService, ExtensionRecords, RecordCardsService, instaladores de Collections/Vault e extensões de acesso do Suindá; comparação de hashes e diferenças materiais dos quatro runtimes.

| Runtime | Providers encontrados no código |
|---|---|
| DEV | Workspace: membership, scope, recursos; ExtensionRecords: scope/membership; RecordCards: acesso/lista/escopo/membros/listagem; Collections: política de board; Vault: disponibilidade de recurso |
| PROD | Mesmas famílias; implementações Records, RecordCards, Collections e Vault idênticas a DEV na comparação de conteúdo |
| Safdoulas | Mesmas famílias comuns; autorização de registros de domínio passa pelas contribuições/definições de ExtensionRecords |
| Suindá | Famílias comuns + permissões adicionais por workspace, acesso por unidade/ancestralidade de registros e autorização contextual de requests |

Inventário descreve registros existentes em arquivos e pontos de instalação, não medição dos callbacks ativos em processos em execução. Não foram reiniciados ou consultados serviços para forçar sua instalação.

Workspaces tem diferenças materiais no tratamento de ROOT/simulação: DEV usa `isRootForAuthorization`; PROD ainda possui usos diretos de `account().is_root`; Safdoulas/Suindá também têm diferenças em relação a DEV. Essas diferenças não foram reconciliadas por refatoração nesta etapa; todos esses providers permanecem bloqueados editorialmente.

## Inventário por família

| Provider / recurso | Dados e avaliação atual | Concessão/revogação e mutabilidade | Compatibilidade editorial |
|---|---|---|---|
| Workspace membership/scope | `workspace_members`, `workspaces.archived_at`, `plugin_settings`; consultas via Db/pool | member/remove; archive; mudanças de plugin; registros de callbacks em memória | Sem conexão dedicada no callback; bloqueado |
| Workspace recursos compartilhados | `workspace_resources`, membros/workspace, `can_edit`, disponibilidade do recurso | share/unshare, entrada/saída de membros, transferência de board, configuração de plugin | Sem pin da política/associação até commit; bloqueado |
| ExtensionRecords scope/membership | `extension_records`, criador, grants exatos `extension_record`; `resourceScoped` e plugin ativo no registry | criação/mutação/estado do registro; grants/roles; mudança de definições/ativação do plugin | Pode haver operações internas transacionais de registros, mas callbacks de acesso usam pool/registry; bloqueado |
| RecordCards board access | `record_card_links`, `extension_records`; `records.detail`, privilégios do plugin e contribuições `recordCards`/projeção | criação/vinculação de board, mudanças no registro e grants, desativação do plugin/dependências | Composição de várias consultas e estado em memória; bloqueado |
| RecordCards list/scope/members/listing | Mapeamento registro/board, grants/membros de registros e `boardPermission`; callbacks distintos | Mesmos vínculos e políticas anteriores; alterações de instalação/providers | Não são equivalentes a autorização de escrita; bloqueados conservadoramente |
| Collections board policy | `boards.is_collection`; privilégio `plugin.collections.read/write`; registry ativo | mudança do board, grants/grupos, ativação/dependências do plugin | Mistura SQL via pool e registry; bloqueado |
| Vault resource availability | `registry.isEnabled('vault')` | ativação/desativação e dependências no registry | Sem versão/pin transacional do registry; bloqueado |
| Suindá perfis por workspace | `suinda_workspace_access_profiles`, membros de perfil e `workspace_members`; soma permissões contextuais | save/remove/assign/unassign dos perfis e memberships | Callback usa pool; tabelas não pertencem ao lock editorial atual; bloqueado |
| Suindá acesso por unidade | `extension_records`, workspace e ancestralidade/referências acadêmicas; grants exatos da unidade | alteração de grants, vínculos/unidades, registros e seus relacionamentos | Sem snapshot/pin conjunto de toda ancestralidade; bloqueado |
| Suindá request permission | usuário, método/path/request, workspace e registros referenciados nas rotas acadêmicas permitidas | permissões/unidades e mutações dos registros/contexto da rota | Sem equivalente para fluxo editorial e sem conexão dedicada; bloqueado |

Não identificado acesso direto a serviço externo nessas famílias de callbacks. Isso não converte o estado em memória do PluginRegistry em estado transacional. A API de registro aceita callbacks arbitrários; um callback externo ou não inspecionado também permanece recusado, sem executá-lo para inferir autorização.

Organizações e unidades de domínio modeladas por registros/ancestralidade não recebem autorização por mera igualdade de workspace ou posse de um board. Não foi inventado um vínculo organizacional universal.

## Correção incorporada

`editorialScopeProvidersPresent` antes só considerava board policies/access, scopes e memberships. Agora considera também record permissions, resource availability/resources, board list/scope/member/listing providers e, no Suindá, scoped/request permission providers. Uma instância com apenas um desses callbacks já falha com `review_scope_adapter_unavailable`.

A alteração só restringe acesso. Não chama callbacks sob outra identidade, não ignora sua política e não transforma retorno `true` em prova transacional. Testados os objetos AccessService reais de DEV e Suindá; Suindá carregado em subprocesso com seu próprio tsconfig/loader. A mesma correção comum foi aplicada aos quatro runtimes, preservando suas diferenças.

## Escopos e garantias

| Escopo | Situação após C4 |
|---|---|
| Pessoal nativo, projeto próprio e sem providers instalados | Cobertura interna delimitada C2; sujeito a permissões explícitas e demais bloqueios |
| Nativo em instância com providers, mesmo que aparentemente não afetem aquele board | Recusado conservadoramente |
| Workspace, recurso compartilhado, organização/unidade/registro de plugin | Bloqueado; nenhum adapter homologado |
| Provider externo ou de garantias desconhecidas | Bloqueado |
| Política/evidência de produção | Fontes ausentes; fachada concreta continua indisponível |

Registro de provider durante avaliação de permissões foi testado: o segundo check observou o novo provider e a decisão sofreu rollback. **Isso não demonstra proteção para qualquer registro em memória entre o último check e o commit.** Não existe lease/seal do registry mantendo a configuração estável até a conclusão; esse limite permanece e impede liberação operacional. Não acrescentamos flags de homologação ou aprovação para contorná-lo.

## Locks: protocolo anterior e resultante

A implementação contém **13 tabelas**, apesar da menção a 14 na especificação. Teste conta a lista real:

`users → access_roles → access_grants → access_groups → access_group_members → access_user_exceptions → access_permission_settings → boards → board_members → lists → cards → ai_projects → vault_items`.

Ordem efetiva: transação READ COMMITTED → advisory lock do agregado → consulta de existência/origem → recusa de providers não homologados → SHARE nas tabelas acima → sessão/escopo/permissões e auditoria → resolução de fontes/histórico/CAS → reautorização/revalidação → INSERT/guards → revalidação → COMMIT. Locks persistem até COMMIT/ROLLBACK. Em histórico não há INSERT editorial.

Antes e depois da C4: mesmas tabelas, modo, ordem e duração de retenção. A mudança resultante só amplia a recusa de callbacks e a evidência de testes; não muda protocolo de writers, granularidade ou timeout de produção.

SHARE é compatível com SHARE de outro leitor/agregado, mas bloqueia ROW EXCLUSIVE de DML comum em toda a tabela. Portanto, duas descobertas independentes podem autorizar em paralelo e ainda assim atrasar alterações de usuários/grupos/boards não relacionados. Fontes lentas mantêm esses locks por mais tempo. Uma sequência de leitores também pode produzir filas e latência administrativa; não foi feita medição de carga sustentada.

Deadlock demonstrado: editorial segura SHARE em users e espera SHARE em access_grants; writer segura ROW EXCLUSIVE em access_grants e tenta UPDATE users. Isso corresponde ao tipo de ordem observado em operações de grants que posteriormente invalidam sessão. Ordem fixa apenas no leitor não ordena todos os writers. PostgreSQL detecta o ciclo e aborta uma transação; rollback é obrigatório, sem liberação manual ou escrita parcial.

## Revogações cobertas e lacunas

DML nas 13 tabelas respeita locks do PostgreSQL: grants/roles/grupos/exceções/desativação de permissão, conta/sessão e vínculos pessoais usados no adapter. Transferência de proprietário de projeto, mudança de workspace do board e troca de lista do card foram bloqueadas em testes enquanto os locks estavam ativos.

Não cobertos como autorização positiva: tabelas extras de workspace/compartilhamento/unidade, conteúdo de registros de domínio, alterações do registry/contribuições em memória e autoridades externas. Não basta adicionar suas tabelas sem preservar também avaliação, identidade, definição do recurso e revogação de todo o grafo.

## Testes e resultados

PostgreSQL 16 descartável, socket Unix privado, sem Docker ou bancos reais. Limites exclusivos do harness: `lock_timeout=2s`, `statement_timeout=5s`, `idle_in_transaction_session_timeout=15s`; teste principal 120s e subprocessos/init/stop limitados a 15s. Testes de espera usam 100ms; deadlock usa lock_timeout de 4s e statement_timeout de 5s. Produção não recebeu esses parâmetros.

Cenários C4: todas as categorias registradas falham fechadas; providers extras reais de Suindá são detectados; SHARE simultâneo em agregados diferentes; bloqueio de escrita não relacionada; transferências de escopo bloqueadas; deadlock SQL real e rollback; registro de callback durante avaliação real causa recusa. Testes anteriores cobrem revogação concorrente, grupos, duplicata após revogação, CAS, autoaprovação e histórico.

Na execução inicial, o subprocesso de teste de Suindá precisou de seu próprio loader/tsconfig para decorators; corrigido somente o harness, sem alterar configuração do runtime. Reexecutado o arquivo afetado: 41 aprovados. Ao final, execução conjunta direcionada: **68 aprovados, zero falhas/ignorados**, em aproximadamente 6,06s. Tempos locais ilustrativos do teste anterior: espera limitada de escrita ~104ms; três transferências ~308ms; detecção/rollback de deadlock ~1,01s. Não são benchmark de produção.

```sh
TSX_TSCONFIG_PATH=forge/app/apps/api/tsconfig.json TSX_DISABLE_CACHE=1 \
 node --import ./forge/app/node_modules/tsx/dist/loader.mjs --test \
 packages/orbit-core/src/execution/discovery-review-sources.spec.ts \
 packages/orbit-core/src/execution/discovery-review-repository.spec.ts \
 packages/orbit-core/src/execution/discovery-review.spec.ts
```

O teste de locks isolados demonstra o protocolo PostgreSQL, não homologação funcional de um provider. As bases usam migrations selecionadas e fixtures mínimas das etapas anteriores, não a cadeia integral dos produtos. Nenhum provider foi declarado válido por fixture, mock ou retorno permitido. A divergência preexistente do teste de simulação ROOT registrada na C2 não foi alterada/reexecutada aqui.

## Arquivos e próximos passos

Modificados somente os quatro `*/app/apps/api/src/access/access.ts` (detecção conservadora), `packages/orbit-core/src/execution/discovery-review-repository.spec.ts` (limites/cenários) e este novo relatório. Nenhuma migration, contrato editorial, proveniência, fonte de evidência/política, configuração de runtime ou mapeamento compartilhado foi alterado.

Uma futura extensão precisa identificar cada provider e suas dependências reais, receber conexão dedicada, coordenar seus writers/revogações e manter identidade/escopo/versões válidos até commit. Registro/alteração do provider e do registry requer fence/lease ou protocolo equivalente, não um booleano de confiança. Substituir SHARE por locks finos requer participação comprovada de todos os writers, incluindo inserções de negações/membership e transferências; isso não é uma alteração pequena segura neste escopo.

Antes de HTTP: homologar esses adapters contra schemas reais, cadeia histórica e identidades dos produtos; resolver ciclo/ordem de locks e avaliar carga; integrar auditoria de recusas sem depender do rollback; estabelecer política/evidência autorizadas reais. Nenhum desses bloqueios foi removido. A etapa C4 está concluída como diagnóstico, testes e correção conservadora; não como liberação operacional ou homologação de providers.

`main` e HEAD `d9307b8e6a54316f802acbd7bcb96baa26116f16` preservados. Sem commit, push, deploy, reinício, limpeza ou alteração em bancos existentes.
