# 07D-C — Fronteira interna e bloqueios de exposição

## Resultado

Implementados os componentes internos seguros permitidos pela cláusula de bloqueio da especificação. **Nenhum endpoint foi registrado e a API editorial não está disponível nos runtimes.** As garantias de autorização em produção ainda dependem de adapter real e das fontes de política/evidência descritas abaixo. Não declarar a integração operacional concluída.

## Inspeção e lacunas comprovadas

- `forge/app/apps/api/src/access/access.ts`: `AccessGuard` autentica Bearer via `AccessService.authenticate`; verifica JWT, conta ativa e `session_version`. Preserva `orbitActor` e usuário efetivo, com mecanismos próprios de simulação/act-as.
- Autorizações existentes usam `access_grants`, `access_roles`, grupos, exceções e configurações de permissões. Consultas de `AccessService` usam `Db`, cujo `query` executa via pool; não recebem uma conexão transacional dedicada e não oferecem protocolo de bloqueio de revogação para este fluxo.
- `execution.service.ts::discoveryDetail` exige ator da execução, acesso ao card, projeto e identidade de manifesto. `execution.controller.ts` expõe a consulta existente da 07C. Isso não concede permissão de revisão independente a outro editor.
- Não localizada permissão editorial específica nem regra que autorize aprovação por outro usuário. Não equiparamos administração, ROOT ou edição de card a aprovação editorial.
- `discovery-journal-host.ts` apresenta evidência histórica sem revalidação. A política de captura da 07C não é política editorial. Não localizada fonte confiável vigente de política editorial/compatibilidade para ativar comandos.
- Por essas lacunas, integrar apenas o guard HTTP existente e inventar permissões não satisfaria reautorização transacional, segregação e política. Comandos e consultas editoriais novas permanecem sem exposição HTTP. A consulta preexistente de propostas não foi alterada.

## Arquivos

Criados:

- `packages/orbit-core/src/execution/discovery-review-application.ts`.
- Este relatório.

Modificados:

- `discovery-review-repository.ts`: hook opcional de autorização dentro da conexão dedicada, após bloqueio e antes da leitura; reexecutado antes da persistência/retorno de duplicata. Extensão indispensável para o contrato transacional, compatível com consumidores internos da 07D-B.
- `discovery-review-repository.spec.ts`: regressões anteriores preservadas e cenários adicionais de aplicação com autoridade exclusiva de teste.

Contratos 07D-A, migrations 209/210, filas, executores, adapters de produção e plugins não foram alterados. Sem projeções publicadas.

## Operações e identidade

A fachada interna oferece `current`, `history` e `decide`. Requer um `DiscoveryReviewHost` construído pelo host confiável; não é DTO de cliente, autenticação nova ou adapter habilitado em produção.

Sem host retorna `review_host_unavailable`/503. Sem sessão autenticada retorna 401. Simulação ou ator diferente do sujeito efetivo retorna 403; não confunde ROOT auditor com usuário simulado. `reviewerId` é preenchido com o ator do host. Corpo contendo `reviewerId` ou campos desconhecidos é rejeitado com 400.

O port de sessão deverá ser implementado sobre o mecanismo JWT/conta existente quando houver integração autorizada. Nesta etapa não existe conexão desse port a requests reais.

## Matriz efetiva

| Operação | Host interno habilitado | Runtimes atuais |
|---|---|---|
| Histórico | Sessão + autorização transacional de leitura | Sem endpoint novo |
| Estado atual | Leitura autorizada + política confiável | Sem endpoint novo |
| Transição | Autorização de decisão + leitura + política/evidência | Sem endpoint novo |
| Aprovação | Condições anteriores + ator diferente do proponente | Indisponível |
| Simulação/act-as | Recusado | Sem endpoint novo |
| Publicação | Não existe | Não existe |

A matriz descreve requisitos da fachada, não novas permissões do catálogo. Nenhum papel/ID de permissão foi criado. A autoridade de teste separa leitura e decisão; não é adapter de produção.

## Escopos e segregação

A origem é UUID validado e fila permitida. O repository confirma fila no capture. Antes de ler histórico ou consultar duplicatas, o hook transacional deve autorizar o recurso e seu escopo completo: runtime, projeto, workspace, card, execução e ator, incluindo vínculos organizacionais que existirem no host. IDs nunca concedem acesso.

A fachada compara o ator autenticado com `discovery_journal_captures.actor_id` da descoberta para recusar autoaprovação. Não aceita proponente informado pelo cliente.

O port não implementa por si uma ACL real para todos esses escopos. Essa cobertura é bloqueio explícito da integração de produção; não existe fallback permissivo. Uma duplicata exige nova autorização antes de qualquer histórico/decisão ser retornado.

## Transação e auditoria

Preservado o advisory lock por agregado e READ COMMITTED. O hook recebe a mesma conexão da transação; seu contrato exige revalidar sessão, escopo e permissões com locks/versionamento compatíveis com as mutações reais de autorização, e auditar o acesso autorizado nessa transação.

Um callback que apenas consulta permissões fora da transação não satisfaz o contrato. O segundo check antes de inserir não substitui os locks necessários. A implementação atual de AccessService não foi apresentada como garantia suficiente nem modificada por refatoração ampla.

Nos testes, uma tabela ACL exclusiva de fixture usa `FOR SHARE`, e o registro de auditoria usa a mesma conexão. Revogação confirmada enquanto o comando aguarda o agregado é observada antes da gravação. Recusa no segundo check faz rollback integral. Esses resultados comprovam o encaixe transacional, não homologam o modelo real de grants/grupos/roles contra todas as revogações possíveis.

Decisões persistidas continuam como histórico de sucesso da 07D-B. Não foi criada auditoria de produção de recusas/consultas: o adapter futuro precisa integrá-la conforme as convenções existentes, sem registrar corpos sensíveis.

## Conflitos e condições editoriais

As regras determinísticas continuam na 07D-A e a persistência na 07D-B. Revisão ou idempotência conflitante é mapeada para 409; validação para 400; ausência de autenticação para 401; recusa para 403; condição/host indisponível para 503. Erros inesperados são sanitizados sem detalhes SQL.

A mesma chave só devolve decisão depois da autorização transacional. Conteúdo divergente continua em conflito, e duplicata autorizada precede CAS obsoleto. Sem política ou resolver de evidência não há comando. Sem avaliação positiva verificada, aprovação é recusada pelo contrato existente. Nenhum cliente fornece política ou compatibilidade no corpo.

Não há fonte de política/evidência de produção configurada. As políticas e avaliações positivas dos testes são fixtures explícitas. Elegibilidade é cálculo, nunca publicação ou indexação.

## Testes

Executados com Node 24.20.0 e TSX:

```sh
TSX_TSCONFIG_PATH=forge/app/apps/api/tsconfig.json TSX_DISABLE_CACHE=1 \
 node --import ./forge/app/node_modules/tsx/dist/loader.mjs --test \
 packages/orbit-core/src/execution/discovery-review-repository.spec.ts \
 packages/orbit-core/src/execution/discovery-review.spec.ts
```

**35 aprovados, zero falhas/ignorados**: nove testes 07D-A, 25 cenários SQL/aplicação e um contêiner de teste. Cobrem os casos solicitados de autenticação/escopo, editor permitido em fixture, falta de permissão, falsificação de identidade, segregação, reautorização, revogação concorrente, duplicatas autorizadas/estrangeiras, CAS, ausência de política/evidência, histórico e ausência de publicação, além das regressões 07D-B.

Cluster PostgreSQL 16 descartável em socket Unix privado, sem Docker. Migrations 209 e 210 aplicadas sem alteração, com tabelas predecessoras mínimas. Não aplicada a cadeia histórica completa: a fonte canônica contém somente oito migrations selecionadas, não todo o bootstrap dos produtos. Não se apresenta essa fixture como homologação de atualização integral. Nenhum banco real foi utilizado.

## Pendências para integração e 07D-D

Antes de abrir endpoints, definir permissões editoriais reais, escopos completos, adapter de sessão/ACL/auditoria transacional que acompanhe todos os caminhos de revogação, política versionada e fonte autorizada de evidência. Validar esse adapter contra o schema real e cadeia histórica completa em banco descartável. Só então registrar controllers seguindo Nest/AccessGuard e testar requests reais.

A interface 07D-D não deve consumir essa fachada como se a API estivesse operacional. Não foram criados UI, publicação, MCP, RAG ou efeitos sobre execução/Codex.

Branch `main` e HEAD `d9307b8e6a54316f802acbd7bcb96baa26116f16` preservados. Árvore preexistente mantida; sem limpeza, commit, push, deploy, alteração de migration ou reinício de serviços.
