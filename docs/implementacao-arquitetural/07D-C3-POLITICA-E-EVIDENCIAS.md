# 07D-C3 — Política editorial versionada e evidências

## Resultado

Concluídas as fronteiras internas verificáveis. **Não existe fonte editorial/evidencial de produção conectada; a funcionalidade não está operacionalmente habilitada.** Nenhum endpoint, controller, interface ou publicação foi criado. Não há política permissiva padrão, autoridade automática ou análise com IA.

## Inspeção e fontes existentes

Inspecionados os contratos/repository/fachada/adapter editorial, captura da 07C e seu host. A 07C registra política de ingestão e referências históricas, com estado `historical_not_revalidated`; não fornece política de aprovação nem atestado atual de compatibilidade. O opt-in/revisão de privacidade do envelope não é aprovação editorial. Hashes identificam conteúdo, não demonstram sua compatibilidade.

A 07D-C2 fornece autorização transacional delimitada, não governança de política nem avaliação de evidências. Não foi localizada fonte efetivamente autorizada para essas duas funções. A implementação, portanto, recebe uma autoridade futura por contrato interno do host e mantém a fábrica concreta sem fontes por padrão.

## Arquivos desta etapa

Criados:

- `packages/orbit-core/src/execution/discovery-review-sources.ts`.
- `packages/orbit-core/src/execution/discovery-review-sources.spec.ts`.
- Este relatório.

Modificados:

- `discovery-review-repository.ts`: resolução na conexão transacional, revalidação antes/depois da inserção, persistência da proveniência e cálculo conservador de elegibilidade.
- `discovery-review-application.ts`: aceita a fronteira transacional de condições do host e mapeia erros de fonte para indisponibilidade explícita.
- `discovery-review-access-host.ts`: parâmetro interno opcional de resolver; obtém runtime/projeto reais do capture depois da autorização. Ausente por padrão.
- `discovery-review-repository.spec.ts`: teste SQL da proveniência, mudança de política/evidência, histórico preservado e rollback por revalidação final.

Nenhuma alteração em AccessService, permissões, bloqueios de tabelas, filas, executor ou migrations. Mapeamentos existentes entre runtimes preservados; sem publicação de projeções.

## Política versionada

O contrato 07D-A permanece como corpo da política: revisão mínima, compatibilidades exigidas e opção de aprovação inelegível. Nenhum valor é escolhido pelo sistema em nome de usuário ou instituição.

O envelope adicional informa `schemaVersion`, escopo exato (runtime/projeto/descoberta/fila), referência `{sourceId,id,version,hash}`, status `active/revoked/unavailable`, início e fim de validade. O digest canônico cobre corpo, escopo, estado e validade. A referência completa identifica a versão; conteúdo igual em versões diferentes pode ter o mesmo hash.

O host configura allowlists separadas de origem para políticas e avaliações. IDs presentes no envelope não autenticam uma origem: a autoridade é um objeto instalado pelo host confiável, nunca criado a partir de request. Não foi registrada implementação dessa autoridade em produção.

A autoridade deve permitir leitura histórica pela referência completa e confirmar que o registro histórico é idêntico ao utilizado. Origem não autorizada, digest divergente, escopo incorreto, revogação, ausência, indisponibilidade e validade vencida/futura são recusados. Não se usa a última política conhecida como fallback.

## Avaliação de evidências

Preservados os estados 07D-A: `unassessed`, `unavailable`, `partially_compatible`, `incompatible`, `compatible`.

Um eixo separado `presence` distingue `missing`, `unknown` e `present`. Assim, inexistência é identificável sem inventar um sexto valor incompatível com o enum legado. Evidência inexistente resulta em compatibilidade `unavailable`; presença desconhecida admite somente ausência de avaliação ou indisponibilidade. Presença física, sozinha, não produz `compatible`.

O envelope identifica fonte, ID, versão, hash, escopo, instante de verificação e validade. Uma avaliação positiva só é aceita com origem autorizada pelo host, integridade, referência histórica recuperável, período válido e confirmação transacional de atualidade. O contrato transporta o atestado de uma autoridade; não implementa nem presume um método para provar semanticamente a compatibilidade.

## Consistência transacional

A resolução ocorre **depois** do lock de agregado e da autorização 07D-C2, pela conexão dedicada do repository. O port exige `postgresql_transaction` e `pinCurrent`, cuja implementação deverá manter a autoridade sobre versões/revogação até COMMIT. Uma declaração textual desse modo não prova a implementação; todo adapter real precisa de homologação própria.

O resolver clona os registros, valida hashes/escopo/tempos, confirma histórico recuperável e revalida depois dessas consultas. O repository revalida antes de inserir e após a inserção; falha em qualquer passo provoca rollback, inclusive da decisão já inserida. Leituras atuais também revalidam antes do retorno.

As rechecagens não substituem locks/versionamento da fonte. Consultar arquivos, serviços externos ou fazer duas leituras não oferece atomicidade com PostgreSQL. Nenhum adapter externo foi criado. A validade temporal é verificada no relógio do host durante essas verificações; não se promete que uma validade jamais possa vencer após o último check/retorno.

Autorização, segregação, CAS, chave idempotente e lock do agregado foram preservados. Duplicatas só são consultadas depois da autorização e da resolução vigente; uma fonte revogada/obsoleta também impede retorno pelo comando idempotente. Histórico autorizado continua consultável independentemente da disponibilidade das fontes atuais.

## Persistência e mudanças posteriores

Não foi necessária migration: `discovery_review_decisions.policy` da 210 já aceita o corpo 07D-A com metadados adicionais. O novo caminho grava `editorialProvenance.schemaVersion=1`, incluindo os envelopes completos de política e avaliação usados na decisão. O digest do comando/idempotência não incorpora essas condições posteriores; mantém o contrato anterior.

O histórico persistido permite recuperar a referência e o conteúdo da política/avaliação daquele momento. O resolver exige também que a autoridade ofereça recuperação histórica. Não foram atualizadas decisões antigas nem criado estado paralelo.

Na resolução versionada, aprovação só conserva elegibilidade quando a proveniência inteira coincide com as condições atuais e a revisão anterior à aprovação atende à política. Mudanças de versão, escopo, critérios, validade ou atestado retiram a elegibilidade de forma conservadora; não migram automaticamente a aprovação. Compatibilidade negativa ou indisponível também impede elegibilidade. Decisões legadas sem proveniência continuam legíveis, mas não herdam elegibilidade desse caminho.

Uma indisponibilidade de política/avaliação retorna erro explícito; não devolve um atestado positivo. O caminho legado interno do repository continua compatível com os testes/consumidores anteriores, mas não representa uma fonte confiável de produção. A fábrica concreta usa somente a nova fronteira quando uma autoridade é fornecida; sem ela, permanece sem política/evidência e a fachada não executa comandos.

Esta etapa não cria um fluxo para reaprová-las após mudanças: a máquina 07D-A mantém suas transições, inclusive estados terminais. Qualquer futura renovação precisa de desenho próprio, sem reescrever a aprovação anterior. Aprovação nunca publica ou indexa conhecimento.

## Testes

Execução unitária inicial: 17 testes de fontes aprovados. O primeiro teste SQL encontrou um erro na fixture: recuperação por hash não distinguia duas versões de conteúdo idêntico. Corrigida a chave histórica da fixture para incluir versão; não foi alterado contrato nem migration para contornar o erro.

Após as alterações finais, execução conjunta direcionada: **62 aprovados, zero falhas, zero ignorados**. São 18 testes de fontes, nove da 07D-A e 35 testes/contêiner SQL das etapas B/C/C2/C3.

```sh
TSX_TSCONFIG_PATH=forge/app/apps/api/tsconfig.json TSX_DISABLE_CACHE=1 \
 node --import ./forge/app/node_modules/tsx/dist/loader.mjs --test \
 packages/orbit-core/src/execution/discovery-review-sources.spec.ts \
 packages/orbit-core/src/execution/discovery-review-repository.spec.ts \
 packages/orbit-core/src/execution/discovery-review.spec.ts
```

Cobertos: ausência/origem de política; versão válida/alterada; revogação/indisponibilidade; estados e presença de evidência; atualidade e digests; recuperação histórica; mudança posterior de compatibilidade; revisão mínima; elegibilidade de aprovação antiga; ausência de publicação; rollback após revalidação final; regressões de autorização, concorrência, CAS, idempotência e imutabilidade.

PostgreSQL 16 descartável em socket Unix, sem Docker ou bancos reais. A fixture de fonte SQL é exclusiva de teste e usa `FOR SHARE` para pin de atualidade. Não é fonte instalada em produção. Preservado o teste com AccessService real da C2 e migrations selecionadas 065/068/070/096/209/210 sobre bases mínimas; não se apresenta isso como aplicação integral de toda a cadeia histórica.

Falha anterior não relacionada: C2 registrou uma divergência no teste legado de simulação ROOT (23/24 aprovados). Esse teste e a lógica de simulação não foram alterados ou reexecutados nesta etapa; a falha não faz parte dos 62 testes acima.

## Bloqueios para integração HTTP

Faltam autoridade editorial real aprovada, política real/versionada e avaliador autorizado de evidências; homologação de recuperação histórica e pin/revogação transacional dessas fontes; adapters de escopos/plugins ainda bloqueados pela C2; integração de sessão real com a fábrica e validação de carga/ordem dos locks. Nenhuma allowlist de produção ou política aprovada foi inventada.

Sem essas condições, produção continua bloqueada. Não houve 07D-D, integração externa ou alteração nas restrições de providers.

`main` e HEAD `d9307b8e6a54316f802acbd7bcb96baa26116f16` preservados. Trabalho preexistente mantido; sem commit, push, deploy, reinício, limpeza ou alteração de bancos reais.
