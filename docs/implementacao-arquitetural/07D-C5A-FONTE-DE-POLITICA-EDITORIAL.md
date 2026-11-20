# 07D-C5A — Fonte interna de políticas editoriais

## Resultado e fonte identificada

Criada uma fonte persistente de **candidatas a política**, com versões imutáveis e histórico verificável. Não existe autoridade institucional implementada para aprovar ou ativar essas candidatas. Não há política ativa, default permissivo nem política criada em nome de instituição.

Inspeção limitada aos contratos C3, host/fachada/repository, migration 210, convenções adjacentes e referências de configuração/governança. A política de captura 07C e as orientações de desenvolvimento não conferem autoridade de aprovação editorial. Nenhuma fonte autorizada reutilizável foi localizada nesse escopo.

A estrutura registra conteúdo fornecido explicitamente ao repository interno. Não escolhe requisitos mínimos ou compatibilidades, não concede autoridade a ROOT e não se registra automaticamente como autoridade C3. Execução editorial e HTTP permanecem bloqueados.

## Arquivos

Criados:

- `packages/orbit-core/sql/migrations/211_discovery_editorial_policies.sql`.
- `packages/orbit-core/src/execution/discovery-editorial-policy-store.ts`.
- Este relatório.

Modificado:

- `packages/orbit-core/src/execution/discovery-review-repository.spec.ts`: aplicação da migration 211 no cluster descartável e oito cenários C5A.

Nenhum contrato anterior, AccessService, provider, fila, executor ou protocolo de locks C4 foi alterado. Migrations 209/210 preservadas; nova numeração 211 disponível também nos diretórios de migrations dos quatro produtos. Nenhuma projeção foi publicada e nenhum banco de ambiente recebeu a migration.

## Estrutura e integridade

`discovery_editorial_policy_versions` guarda fonte lógica fixa `orbit-editorial-policy-store/1`, ID, versão, hash, descoberta, envelope C3, proveniência e instante de cadastro. A referência completa é `{sourceId,id,version,hash}`. A chave `(source_id,policy_id,version)` é única, inclusive entre escopos; o identificador escolhido precisa distinguir políticas destinadas a escopos diferentes.

O conteúdo do envelope é serializado canonicamente e seu digest é conferido em TypeScript na leitura e em PostgreSQL na inserção. O hash cobre corpo da política, escopo, estado e vigência, conforme C3. A proveniência de submissão fica separada, imutável no banco; ela é atribuição declarada, não credencial ou aprovação.

O escopo exato é runtime/projeto/descoberta/fila. O trigger compara esses dados ao capture 07C da descoberta referenciada; FK impede exclusão destrutiva da origem. Não existem cascatas de exclusão do histórico.

As versões mantêm `status='unavailable'`, sem possibilidade de persistir `active` nesta migration. Vigência é informada pelo chamador e validada, sem datas permissivas escolhidas automaticamente. Cada versão permanece recuperável pelo seu conteúdo e referência originais mesmo após revogação.

`discovery_editorial_policy_events` registra somente `content_validated` e `revoked`, com revisão sequencial, ator atribuído, motivo e timestamp do banco. UPDATE, DELETE e TRUNCATE são recusados nas duas tabelas. Não há rotina de expiração/destruição; retenção administrativa exige decisão e implementação posterior autorizada. Donos/superusuários do banco podem contornar mecanismos SQL; isso não constitui proteção contra administradores.

## Separação de governança

| Operação | Implementação |
|---|---|
| Cadastro | Repository interno; registra candidata sem concessão institucional |
| Checagem de forma | Contrato 07D-A e integridade do envelope/hash/escopo |
| Validação de conteúdo | Evento explícito `content_validated`; significa apenas conformidade estrutural |
| Aprovação institucional | Indisponível: `review_policy_approval_authority_unavailable` |
| Ativação | Indisponível: `review_policy_activation_authority_unavailable` |
| Revogação da candidata | Evento append-only `revoked`, terminal para essa versão |

Checar a forma no cadastro não substitui o evento explícito de validação e nenhuma dessas duas ações aprova os critérios institucionalmente. As ações SQL permitidas não incluem `approved` ou `activated`. `approve` e `activate` do repository falham sempre; nenhuma identidade especial é aceita como autoridade.

O estado de governança é derivado da existência da versão e dos eventos ordenados. Não existe coluna corrente mutável que possa divergir do histórico. Repetir validação ou adicionar evento após revogação é recusado; nova proposta exige outra versão/identificador. O envelope C3 original não muda para `revoked`: a revogação verificável pertence ao histórico de governança e é consultada pelo pin.

## Protocolo transacional

Cadastro e eventos usam conexão dedicada do pool e transação READ COMMITTED, com rollback integral em caso de falha. A gravação de evento bloqueia a versão-pai com `FOR UPDATE`. Um trigger faz o mesmo para INSERT direto, garantindo serialização e revisão sequencial também fora do método TypeScript.

`pinCandidate` usa `FOR SHARE` na mesma versão-pai e consulta o histórico depois do bloqueio. Enquanto a transação chamadora mantém esse pin, a inserção de revogação aguarda o lock incompatível. Se a revogação confirma primeiro, o pin observa o evento e recusa a candidata. A integração exige a **conexão dedicada já dentro de uma transação**; chamar o método via pool/autocommit não mantém um lease até outra operação.

Esse pin garante estabilidade da existência/governança da candidata, não aprovação institucional nem validade de uma decisão editorial. `pinActive` permanece bloqueado, mesmo depois de um pin de candidata bem-sucedido. Não se declara atomicidade com arquivos, registry em memória ou sistemas externos.

O lock do novo registro é local à sua versão e não substitui nem altera os locks editoriais C4. Sua integração futura com autorização de governança e fontes de evidência precisa homologar a ordem completa de locks.

## Fronteira C3

A leitura histórica devolve envelope C3 íntegro, proveniência de submissão, estado de governança e eventos. `current` devolve `null`: o esquema desta etapa não contém versões ativas. `pinActive` não pode converter uma candidata em autoridade confiável.

Não foi criado um `EditorialSourceAuthority` de produção reunindo política e evidência. Nenhuma allowlist da fábrica foi configurada. O teste confirma que C3 recusa a candidata indisponível mesmo quando sua origem está na allowlist de uma fixture. Não se conecta a fábrica concreta a uma fonte fictícia.

Decisões editoriais e sua proveniência histórica permanecem intactas. CAS, idempotência, segregação e elegibilidade calculada não foram modificados. Registrar ou revogar uma candidata não publica conhecimento nem reescreve decisões existentes.

## Testes

PostgreSQL 16 descartável por socket Unix, sem Docker ou bancos reais, usando o harness limitado da C4. A migration 211 foi aplicada após 209/210 sobre as fixtures mínimas anteriores; não se declara validação integral de toda a cadeia histórica dos produtos.

Oito cenários novos: fonte vazia; cadastro inativo; unicidade/versionamento/digest/referência completa e escopo; evento de validação separado; aprovação/ativação indisponíveis; proteção de UPDATE/DELETE/TRUNCATE; pin contra revogação concorrente; recusa da candidata na fronteira C3.

No teste concorrente, INSERT direto de revogação aguardou o lock do pin e atingiu `lock_timeout=100ms`. Após encerrar o pin, a revogação foi registrada, a referência histórica continuou recuperável e o pin seguinte foi recusado. Isso valida coordenação PostgreSQL da candidata, não existência de autoridade institucional.

Execução direcionada do arquivo SQL: **50 aprovados**. Execução conjunta final: **77 aprovados, zero falhas/ignorados**, incluindo regressões A/B/C/C2/C3/C4.

```sh
TSX_TSCONFIG_PATH=forge/app/apps/api/tsconfig.json TSX_DISABLE_CACHE=1 \
 node --import ./forge/app/node_modules/tsx/dist/loader.mjs --test \
 packages/orbit-core/src/execution/discovery-review-sources.spec.ts \
 packages/orbit-core/src/execution/discovery-review-repository.spec.ts \
 packages/orbit-core/src/execution/discovery-review.spec.ts
```

A falha legada de simulação ROOT documentada na C2 permanece separada; seu teste não foi alterado nem reexecutado nesta etapa. Nenhuma fixture aprovada foi utilizada para declarar autoridade de produção.

## Limites e decisões institucionais pendentes

O repository é persistência interna, não uma API autorizada. Ator e origem são atribuições de submissão; antes de qualquer exposição, é necessário definir quem pode cadastrar, validar, revogar, aprovar e ativar, a instituição competente, delegação e segregação, revogação dessa autoridade e auditoria autenticada. Até isso existir, não há adapter de governança nem endpoints administrativos.

Também é necessário decidir como a aprovação/ativação futura será representada sem alterar o envelope indisponível já imutável. Não se pode simplesmente mudar `status` da versão atual: isso quebraria seu hash e seu histórico. A resolução de uma referência ativa futura requer contrato/versionamento próprio, prova de autoridade e recuperação histórica correspondente.

## Pré-requisitos para 07D-C5B

Confirmar o escopo da próxima etapa; estabelecer decisões institucionais e modelo de aprovação/ativação antes de liberar política ativa; homologar identidade/ACL/auditoria e locks da governança; definir a fonte autorizada de evidência, se esse for o objetivo da C5B. Permanecem os bloqueios C4 de providers/escopos e de estabilidade do registry, além da ausência de evidência autorizada.

Nenhum desses requisitos foi presumido como resolvido. A C5A conclui a estrutura verificável de candidatas e identifica o limite de governança; não libera o Discovery Review e não executa C5B.

Branch `main` e HEAD `d9307b8e6a54316f802acbd7bcb96baa26116f16` preservados. Trabalho anterior mantido; sem commit, push, deploy, reinício, limpeza ou alteração em bancos existentes.
