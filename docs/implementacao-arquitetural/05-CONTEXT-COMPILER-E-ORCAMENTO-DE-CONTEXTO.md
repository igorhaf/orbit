# Implementação 05 — Context Compiler e orçamento de contexto

Referência final de código, contratos e validação isolada. Snapshot desta entrega: **2026-11-14**, branch **main**, HEAD **d9307b8e6a54316f802acbd7bcb96baa26116f16**. Não representa implantação.

## 1. Resumo executivo

**CONCLUÍDA no escopo de código, testes isolados e distribuição de fontes em arquivos.** O Core fonte passa de1.7.7 para **1.8.2**, com **197 mappings**. API Core permanece1.0.0, Plugin API1. Foram preservados os bancos, configurações e serviços dos quatro runtimes.

A etapa acrescenta um compilador determinístico do Core que recebe fontes autorizadas da04 e material tipado dos builders existentes. Organiza o texto em seções, reserva material obrigatório, aplica orçamento explícito a material opcional, deduplica equivalências comprovadas e registra decisões, omissões e hashes. Não cria Registry, fila, provider ou mecanismo de recuperação paralelo.

As duas filas usam a nova política somente quando o host opta por ela. Runs históricos conservam seu modo; compilação incompatível não faz fallback ao legado. Manifestos continuam imutáveis, sessões incompatíveis não são retomadas silenciosamente e resultados concluídos continuam preservados quando as fontes mudam.

Resultado: **257 testes distintos aprovados,0 falhas finais,0 ignorados**, incluindo17 cenários filhos do harness compilado e1 teste de orquestração, contados uma vez. As quatro APIs passaram TypeScript. Não foram executados Codex real, modelos pagos, embeddings, bancos de produto, migrations reais, implantação ou reinício. A validação operacional continua pendente e separada.

## 2. Base documental

A base histórica são as sondagens00–20 e os cinco relatórios existentes01/02/03A/03Bfinal/04. Leituras integrais anteriores dos documentos inalterados foram reaproveitadas; as frentes voltaram aos contratos e leram os documentos pertinentes à05. O relatório04 completo foi a referência de handoff e seu estado foi confrontado com código/preflight, sem tratar documentação como prova operacional.

| Base | Consequência na05 |
| --- | --- |
| Sondagens00–09 | Preservar monorepo, arquitetura existente, limites operacionais e diferentes responsabilidades de cards/projeto/execução. |
|10–17 | Não transformar revisão da demanda em versão integral de projeto; separar contexto, intenção e resultado; recuperação não concede autoridade. |
|18/19 | Testes isolados, quota fake, Git/PG próprios; nenhuma retomada destrutiva, MCP ou promessa de isolamento universal. |
|20 | Compiler no Core, plugin IA consumidor; capabilities/actions/RBAC e consumidor vetorial de Suindá mantidos. |
|01 | Preflight e publicação selecionada, sem apagar variantes para liberar gate. |
|02 | Revisões monotônicas, snapshots/CAS/freshness/idempotência preservados. |
|03A | Coordinator, locks, ownership, supervisor e quarentena preservados. |
|03B final | Worktrees opt-in, pin Git, common-dir serializado e integration:not_integrated preservados. |
|04 final | ContextSource/Manifest/Repository, SHA canônico, ledger160 e API autorizada reaproveitados. |

Foram consultados AGENTS.md, skill orbit-environment, docs/product-experience.md, docs/acceleration/README.md, orbit.workspace.json, package manifests, contratos de plugins e ferramentas shared/preflight. O trabalho é direto no IDE, sem contexto de cartão fornecido; não se inventou card/write_scope para autorizar esta implementação.

As novas regras foram sincronizadas em AGENTS.md, experiência de produto e orbitArchitecturePrompt nos quatro runtimes. A skill de identificação de ambiente não mudou de responsabilidade e não precisou ser modificada.

## 3. Estado inicial

- Branch main; HEAD d9307b8e6a54316f802acbd7bcb96baa26116f16, preservados no encerramento. Nenhum stage/commit/tag/push foi executado.
- Core fonte1.7.7/191 mappings; UI1.1.3/74 mappings. Core API1.0.0/Plugin API1 são contratos distintos da versão do pacote fonte.
- Árvore já alterada pelas etapas01–04 e trabalhos de produto. Foi capturado inventário de hashes de **1420 arquivos** e status completo antes da05; não se atribuiu o diff inteiro contra HEAD a esta etapa.
- Migrations157/158/159/160 existentes. Nenhuma foi presumida instalada em bancos reais.
- Preflight inicial somente leitura: BLOCK, incluindo as nove variantes UI anteriores e condições estáticas/operacionais não verificadas. Isso não foi tratado como aprovação.
- Sem drift inicial do Core e sem locks pendentes. Variantes UI: codex-limits.tsx e plugin-navigation.tsx nos quatro runtimes, mais access-shell.tsx de Safdoulas.

## 4. Arquitetura anterior

ProjectRegistry resolvia configuração, agentes, skills, regras, knowledge e arquivos explicitamente escolhidos, com autorização do projeto e proveniência. ContextBuilder montava blocos concatenados e aplicava limite legado de60KB. PromptSessionsService preparava demanda, skills, referências, checklists, imagens, conversa e instruções operacionais em texto próprio.

A04 já capturava fontes, escopo, revisão, Git/checkout e hashes do material por run/turno. Workers revalidavam antes de executar e registravam observação final separada. Entretanto, não havia política compartilhada para priorização, orçamento, omissão ou deduplicação do material entregue.

Os adaptadores acrescentavam texto: CodexExecutor inclui action/permissões/restrições; CodexAiService inclui arquitetura e, quando configurado, escopo de escrita. A05 inspecionou essas fronteiras. No modo compilado, a arquitetura já vem como material obrigatório e não é repetida pelo provider; no legado permanece a composição anterior.

## 5. Decisões técnicas

| Alternativa/decisão | Justificativa e limite |
| --- | --- |
| Módulo puro execution/context-compiler.ts | Sem FS, DB, quota, IA ou provider. Consome evidências já autorizadas; não concede acesso. |
| Blocos dos builders reais | Não analisar um prompt concatenado por heurísticas nem descobrir documentos arbitrariamente. |
| Opt-in por hostenv, padrão03B | Reutiliza padrão operacional existente; não cria sistema de flags nem aceita ativação por prompt/configuração de usuário. |
| configuration.contextCompilation | Extensão aditiva no JSONB da04; dispensa tabela/migration nova e preserva hashes históricos. |
| Estimativa conservadora UTF-8 | Não foi encontrado tokenizador LLM compatível com executor. BM25 já tem chars/4, mas não é tokenizer e não controla o provider. |
| Texto opcional inteiro ou trechos exatos do host | Não há resumo por LLM, corte arbitrário de código/regras ou aprovação automática. |
| Callback interno de entrega | Adaptação registra hash do envelope efetivo antes de enviar à CLI. Callback não é exposto a actions de plugins. |
| Comparação de retomada por fontes+política+blocos compartilhados | Um delta de pergunta pode mudar o turno sem permitir troca silenciosa do material anterior. |

O compilador não promete atomicidade FS+PG, inspeção da memória interna do Codex, precisão faturável, sandbox universal ou validade semântica. Não foram introduzidas dependências externas.

## 6. Contratos do Context Compiler

Exports principais em packages/orbit-core/src/execution/context-compiler.ts:

```ts
compileContext(input: ContextCompilerInput): ContextCompilationResult
defaultContextCompilerPolicy(overrides?: Partial<ContextCompilerBudget>): ContextCompilerPolicy
contextCompilerMaterialBudget(policy: ContextCompilerPolicy): number
compilationMetadata(result: ContextCompilationResult): ContextObject
```

Input: identity:ContextManifestIdentity; turn opcional; sources:ContextSource[]; blocks:ContextCompileBlock[]; policy; git/checkout opcionais. Identidade contém runtime/projeto/workspace/ator/card/revisão/fila/run/executor/tipo. O método reutiliza validação da04 e não autoriza fontes por posse de ID.

Block: id, section, sourceIds, text, required, priority opcional, kind:text|structured e excerpts opcionais. SourceIds precisam existir no conjunto selecionado, com escopo compatível. O host constrói esses blocos após observar o conteúdo; texto documental não pode acrescentar blocos, escopos ou rótulos privilegiados.

Policy: schemaVersion1, id orbit-context-compiler/1 e budget explícito. Result: schemaVersion1, status ready|blocked, identity/turn, policy, text, compiledHash, fingerprint, sections/absentSections, decisions, sourceUsage, metrics, warnings e blockers.

Decisions registram blockId/sourceIds, included/partial/omitted/deduplicated, motivo, originalHash/deliveredHash, estimativas e duplicateOf. sourceUsage diferencia metadata_only de inclusão/uso parcial/omissão/deduplicação; uma fonte com alguns blocos omitidos fica partial.

ContextSource.required da04 continua significando disponibilidade/verificabilidade obrigatória para captura. Block.required significa material indivisível que deve ser entregue. Não foram confundidas as duas dimensões; uma fonte pode permanecer selecionada para rastreabilidade enquanto seu corpo opcional é omitido.

ContextCompilerError trata entrada/identidade/política inválida. Resultado blocked contém impedimentos de dependência/orçamento; chamadores não executam nem retornam ao builder legado depois da falha.

## 7. Organização do contexto

Ordem de apresentação: task, rules, technical, dependencies, history, operations. Seções vazias são registradas em absentSections e não recebem conteúdo inventado. Cada bloco é renderizado como JSON canônico com seu ID, fontes, rótulos de confiança e conteúdo escapado.

No genérico: demanda; arquitetura; agente/regras; skills; instructions/AGENTS/write_scope; arquivos/knowledge e cards relacionados; identidade técnica/permissões/escopo. Runtime/projeto/workspace/executor são observações do host, sem inserir raízes físicas privadas no texto por conveniência.

No prompt: demanda e instrução atual; arquitetura e orientação operacional; controles do executor; skills; checklists; referências selecionadas; comentários históricos; pergunta anterior identificada como resultado; orientação de continuidade e indicação de imagens entregues separadamente.

Git/checkout continuam vinculados pelo manifesto e comparados nas duas filas. A API pura admite esses campos no input; os builders integrados mantêm o vínculo técnico pela04, sem injetar cópias textuais da identidade física. Não se afirma que o executor recebeu todo metadado do manifesto em seu prompt.

Arquivos/configuração/contratos que só sustentam seleção podem ser metadata_only. Essa classificação não afirma entrega do corpo. Não há inclusão automática de toda árvore, caches, credenciais, node_modules ou documentos não selecionados.

## 8. Priorização

A política é lexical e versionada, sem pontuação probabilística:

1. Material required e fechamento das suas dependências materiais.
2. Prioridade explícita direct, explicit, related, historical.
3. Ordem de seção e ID lexical para desempates determinísticos.
4. Dependências são examinadas antes dos consumidores para decidir disponibilidade e inclusão.
5. Validade, escopo e proveniência vêm da04; relevância nunca amplia permissões.
6. Deduplicação segura precede descarte por custo, quando já existe equivalente incluído.
7. Opcional que excede limites ou depende de material omitido/parcial é explicitamente omitido.

Ciclos/dependências selecionadas ausentes bloqueiam; dependência com corpo necessário não pode ser escondida como omissão opcional. Config/plugins sem corpo selecionado podem sustentar dependências apenas como metadados verificados. Ordem de apresentação em seções é distinta da ordem de alocação.

Conhecimento histórico não vira mais confiável por ser recente. Versões distintas são preservadas. Divergência verificável de hash para mesma identidade/recurso/versão gera source_content_conflict_unresolved, preservando as evidências; não é resolvida por data, IA ou preferência implícita.

## 9. Orçamento

Método: **utf8-bytes-upper-bound/1**, um byte UTF-8 contado como uma unidade estimada conservadora. Trata-se de limite local de material, não tokenização do modelo nem consumo faturável. Inclui escaping JSON, rótulos e cabeçalhos do texto compilado.

Investigação: tools/orbit/knowledge.mjs já oferece approximateTokens=ceil(chars/4) e tokenBudget*4 para recuperação BM25 local. Não é tokenizador compatível com executor e sua truncagem não foi transplantada para material obrigatório. @tokenizer/token nos locks pertence a parsing de mídia, não tokenização LLM. Não foram adicionados tiktoken, dependência remota ou consultas pagas.

Defaults do host:

| Campo | Valor |
| --- | ---: |
| maxEstimatedTokens |120000 |
| reservedExternalTokens |20000 |
| reservedResponseTokens |16000 |
| reservedOperationTokens |8000 |
| safetyMarginRatio |0.10 |
| documentMaxEstimatedTokens |32000 |
| historyMaxEstimatedTokens |12000 |
| perResourceMaxEstimatedTokens |24000 |
| providerContextWindow |ausente/desconhecida |

Sem janela conhecida, maxEstimatedTokens é apenas teto de entrada do host. Com providerContextWindow declarada pelo host, o teto C=min(maxEstimatedTokens,window-response-operation). Sem ela C=maxEstimatedTokens. Material disponível=max(0,floor((C-reservedExternalTokens)*(1-margin))). Default disponível=90000 unidades estimadas.

Janela numérica configurada é declaração do host: validação de formato não comprova capacidade real do modelo. Nenhuma capacidade operacional de provider foi consultada nesta etapa. A origem/comprovação dessa configuração deve ser revista na homologação; os defaults não inventam uma janela.

Material obrigatório é reservado integralmente e pode exceder os limites individuais/documental/histórico aplicados ao opcional; o teto global sempre o limita. Se não couber, bloqueia. Reservas tarefa/regras são efetivadas pela pré-alocação required, sem quotas fixas que permitam eliminar requisitos.

Opcionais são incluídos inteiros se couberem no teto global, no limite por recurso e no limite da categoria. Apenas trechos integrais, ordenados e exatamente presentes no texto podem reduzir documentação explicitamente indicada pelo host. Material structured/regras/host_policy/required nunca recebe esse corte. Os builders desta entrega preferem inclusão/omissão de blocos inteiros e não geram excerpts automáticos.

Deduplicação exige texto exato, seção e descritores equivalentes de escopo, confiança, origem, resourceId, versão, hash e proveniência. Aliases preservam identidades/vínculos nos metadados; versões ou confiança diferentes não são fundidas.

Métricas: teto configurado/disponível, método/estimated/billableTokensKnown=false, volume elegível original e compilado, required, estimativa deduplicada/omitida, quantidades de blocos/fontes por decisão e impedimentos. Não foi medida economia financeira real; os exemplos sintéticos comprovam somente remoção determinística de redundância e respeito aos limites.

## 10. Proveniência e confiança

Rótulos vêm das fontes do host: host_policy, documental, observation, historical, hypothesis, result. A demanda é uma instrução explícita no domínio do cartão, sem se tornar developerInstructions privilegiada. Comentários ficam históricos e a pergunta anterior é resultado de execução, não regra aprovada.

Renderização JSON impede que marcadores dentro do corpo alterem a estrutura ou a confiança atribuída pelo host. Isso é separação estrutural, não proteção universal contra prompt injection nem sandbox do modelo. O caller interno deve continuar observando/autorizando fontes antes de construir a entrada.

No novo modo, redactContext aplica redação de credenciais sem cortar o conteúdo. redact legado preserva seu limite64000. Foi evitado backtracking repetitivo no reconhecimento de chaves sensíveis para que texto obrigatório longo seja analisado sem o custo quadrático observado no teste. Registros de blocos possuem hash do corpo efetivo completo; hashes/rawHash da04 mantêm sua semântica histórica, inclusive o hash de preview quando aplicável.

Um conflito documental detectável gera aviso e preservação, sem decisão aprovada fictícia. Não há motor de conflitos semânticos ou aprovação automática de resultados de agentes.

## 11. Integração com manifestos

Nenhum novo manifesto incompatível foi criado. configuration.contextCompilation contém metadados aditivos da compilação; assemblyPolicy identifica orbit-context-compiler/1. No legado continua orbit-context-builder/1 ou orbit-prompt-sessions/1, sem metadata de compilação fabricada.

Semânticas preservadas:

- material.contextHash e promptHash continuam hashes do texto preparado/entregue na fronteira de execução existente; no modo novo esse texto é o compilado.
- manifest.fingerprint continua fingerprint de contexto da04, incluindo configuração e material.
- integrityHash continua validando o manifesto completo e sua atribuição.
- compilation.fingerprint é identidade determinística distinta da política, seleção, decisões e material; exclui run operacional e timestamps não semânticos, mas inclui turno.
- compilation.compiledHash é SHA-256 do texto compilado, não do envelope adaptado.
- delivery.envelopeHash identifica o texto final controlado pelo adaptador e enviado em stdin.

compilationMetadata remove text/identity/turn/Git físico; conserva política, decisões, sourceUsage, hashes e métricas. O manifesto já vincula run/card/revisão/checkout. Não se armazenam corpos extras no ledger só para permitir hash.

Idempotência retorna o run/manifesto originais antes de recalcular modelo/config atual. Fontes mudadas geram observações separadas; uma recompilação atual não reclassifica o manifesto antigo. Material omitido permanece identificado como omitido, sem recibo de entrega de seu corpo.

## 12. Implementação arquivo por arquivo

Caminhos relativos à raiz. Cada fonte canônica tem quatro projeções oficiais nos caminhos apps/api correspondentes; a tabela explicita famílias para evitar repetir o mesmo contrato quatro vezes.

| Arquivo | Antes → alteração, razão, consumidores, compatibilidade e risco |
| --- | --- |
| packages/orbit-core/src/execution/context-compiler.ts | Novo compilador puro/contratos/policy/budget/renderer/dedup/metadados. Consumers:builders/host/tests; requer entradas já autorizadas e kind correto para código. |
| packages/orbit-core/src/execution/context-compiler.spec.ts |24 testes novos de determinismo, confiança, custos estimados, dependências, omissões, conflitos e escopo; sem I/O. Não homologa provider. |
| packages/orbit-core/src/execution/context-compiler-host.ts | Novo adaptador hostenv e modo capturado por manifesto. Consumer:filas/builders. Padrão off e fail-closed para políticas divergentes; knobs não concedem autorização. |
| packages/orbit-core/src/execution/context-compiler-host.spec.ts |3 testes novos de flags/budgets/legado/política capturada, com env sintético passado por parâmetro. |
| packages/orbit-core/src/execution/context-delivery.ts | Novo contrato interno e verificação compiledText/envelope/hash/orçamento. Consumers:dois adaptadores. Não mede memória/imagens/ferramentas. |
| packages/orbit-core/src/execution/context-delivery.spec.ts |3 testes de substituição, overhead, hashes e redação longa. Não chama CLI. |
| packages/orbit-core/src/execution/context-builder.ts | Mantém composição legada; constrói typed blocks paralelos e compila quando opt-in. Fontes/resources continuam rastreados; opcionais podem ser omitidos somente no novo modo. |
| packages/orbit-core/src/execution/context-registry.spec.ts |11 testes herdados preservados+1 sobre material obrigatório além do corte legado e orçamento insuficiente. FS/DB fake; sem efeitos de produto. |
| packages/orbit-core/src/execution/context-runtime.ts | DTO autorizado existente ganha resumo seguro de compilação e allowlist de recibos. Não expõe corpos, metadata arbitrary ou raízes. |
| packages/orbit-core/src/execution/context-runtime.spec.ts |3 testes anteriores+2 de resumo seguro/callback não exposto a plugins. Usa registry real e fontes sintéticas. |
| packages/orbit-core/src/execution/execution.service.ts | Modo capturado guia build/worker/API/final/worktree; input compilado exato e callback de entrega Codex; política alterada é registrada e bloqueada. Fluxo/idempotência/status anteriores preservados. |
| packages/orbit-core/src/execution/types.ts | ExecutionInput ganha contextDelivery opcional interno, sem exigir campo em callers legados nem payload público novo. |
| packages/orbit-core/src/execution/codex-executor.ts | Envelopamento anterior agora é variável exata verificada antes do spawn/stdin no modo novo. Sem novo executor/process manager. |
| packages/orbit-core/src/execution/registries.ts | Remove contextDelivery da ExecutionInput exposta a plugin actions. Capability/callback de atestação permanece no host; contratos públicos existentes continuam disponíveis. |
| packages/orbit-core/src/execution/security.ts | redactContext completo e correção de reconhecimento de chave sem retries internos; redact mantém corte legado. Testes cobrem padrões sensíveis e tail longo. |
| {dev,prod,safdoulas,suinda}/app/apps/api/src/plugins/ai/prompt-sessions.ts | Typed blocks reais, flag/mode/turno, compilação/revalidação, comparação compartilhada de retomada e recibo. Alterações localizadas; não substitui arquivo de produto por DEV. |
| {dev,prod,safdoulas,suinda}/app/apps/api/src/plugins/ai/codex-provider.ts | Novo último parâmetro opcional de atestação; evita duplicar arquitetura compilada; verifica escopo/envelope e propaga contrato em fallback de sessão. Composição e diferenças de fallback legado preservadas. |
| {dev,prod,safdoulas,suinda}/app/apps/api/src/orbit-architecture.ts | Sincroniza instrução persistente de compilação/orçamento/limites com o painel e cartões; namespace próprio preservado. |
| tools/orbit/context-workers.test.mjs | Harness04 estendido sem copiar classes; modo padrão off e novo modo de teste compilado. DB/quota/executores fake e Git/worktrees temporárias. |
| tools/orbit/context-compiler-workers.test.mjs | Novo wrapper com env allowlist; prova17 cenários reais das filas em opt-in e conta testes filhos separadamente. |
| tools/orbit/context-compiler-provider.test.mjs | Novo teste dos dois adaptadores reais com CLI Node fake, HOME fake e substituição apenas do preparo de HOME legado. Compara stdin real com recibo. |
| packages/orbit-core/package.json; orbit.workspace.json |6 mappings novos e releases selecionadas1.8.0/1.8.1/1.8.2. Não mudam Core API/Plugin API. |
| {dev,prod,safdoulas,suinda}/app/orbit.shared-lock.json | Atualização oficial só do Core; UI íntegra anterior preservada. |
| AGENTS.md; docs/product-experience.md | Regra persistente e limites sincronizados nos canais de execução. |
| docs/implementacao-arquitetural/05-CONTEXT-COMPILER-E-ORCAMENTO-DE-CONTEXTO.md | Este handoff; não substitui nem reescreve relatórios01–04. |

Não foram alterados migrations157–160, coordinator/supervisor/checkout manager, rollback, provider externo, UI, vetorização ou dados operacionais. Os arquivos com código anterior alterado permanecem atribuídos apenas pelos deltas da05.

## 13. Integração com card_runs

Enqueue mantém autorização de card/projeto, revisão do mesmo snapshot e request-key original. Resolução existente produz fontes e material; quando opt-in, ContextBuilder compila e anexa metadata. Manifesto é vinculado ao run na mesma transação já existente; preparação é revalidada para detectar drift, sem alegar snapshot atômico FS+PG.

Worker carrega o manifesto antes de escolher o modo. compilerPolicyForManifest retorna null para legado mesmo se o host for ativado depois. Compilado exige host ligado e política idêntica; alteração é registrada como incompatibilidade e impede execução.

Dentro do lease, reautoriza fontes/revisão/raiz, recompila no modo capturado e compara manifesto/material antes de construir ExecutionInput. Codex recebe context.prompt exato e um contrato interno; o adaptador verifica hash/orçamento e persiste recibo antes de stdin. Actions de plugins recebem material de ExecutionInput, mas não o callback capaz de atestar entrega.

Depois do executor/checks/escopo, finalRunContext observa fontes atuais. Drift ou falha de observação não descarta o output. Sucesso/freshness da demanda/contexto/integração mantêm dimensões independentes. integration:not_integrated da03B continua sem merge automático.

## 14. Integração com card_ai_runs

Composição legada permanece disponível por padrão. Com flag habilitada, o collector usa os mesmos dados efetivos do fluxo: demanda/revisão, configuração, skills, checklists, cartões relacionados, imagens hashadas, conversa, instrução atual e políticas do host. Constrói blocos, aplica orçamento e persiste prompt compilado e manifesto/metadata. Não recupera embeddings ou novas fontes.

Instrução atual, demanda, políticas, skills, checklists e controles são obrigatórios. Referências relacionadas e comentários históricos são opcionais, inteiros e rastreáveis. Imagens seguem como anexos separados; seu custo não é estimado como texto. A conversa histórica não afirma ser completa quando partes forem omitidas, e o comentário atual permanece obrigatório.

A revalidação anterior ao provider recompila as observações autorizadas do checkout apropriado e exige compatibilidade com o manifesto. O texto aprovado, não o makePrompt legado, é entregue ao execute. O último parâmetro opcional contém compiledHash/policy/onDelivery; no legado ele é ausente.

Retomada usa a sessão do próprio run/checkout. Turno é capturado antes de persistir o manifesto filho para não mudar fingerprint durante a espera. Fontes compartilhadas, política e decisões dos blocos compartilhados precisam permanecer iguais. Só os blocos turn/question-continuity/previous-question são deltas autorizados da pergunta; o manifesto pai permanece intacto. Resposta maior que altere material compartilhado por orçamento exige nova preparação.

Mudança de política ao responder registra resume_rejected e retorna conflito, preservando pergunta/sessão/histórico. O mesmo ocorre para mudanças de fontes/material. Compatibilidade de outros runs não comprovada leva a sessão nova, como na04.

Modelos/effort, quotas, multiagent, callbacks, eventos, perguntas e diferenças de produto foram preservados. A memória interna de uma sessão CLI não foi inspecionada nem limitada. O fallback protocolar existente para sessão ausente é sinalizado e conserva o contrato de material da execução; não aprova mudança de fonte, run ou worktree.

## 15. Compatibilidade com plugins

Compiler importa apenas contrato determinístico da04/crypto. O Core não passa a depender de classes concretas do plugin IA. PluginRegistry/PluginDefinition/actions/capabilities/dependências/RBAC continuam sendo os existentes; sem nova fila/registry/extensões dinâmicas.

As filas continuam registrando as capacidades/versões relevantes da04, incluindo disponibilidade do plugin. IA desligada não impede uso puro do compilador no Core; operações que exigem IA continuam bloqueadas. A atestação de entrega foi removida do input exposto às actions para não dar ao plugin poder de registrar um recibo privilegiado.

Recuperação BM25 de tools e consumidor vetorial de Suindá não foram alterados. Vetor existente pode exigir embedding pago; por isso não foi chamado nem integrado automaticamente. Nenhum dado de outro produto pode entrar no compiler por relevância sem passar a autorização do host.

## 16. Persistência

**Nenhuma migration nova.** configuration.contextCompilation e assemblyPolicy cabem no JSONB já persistido por context_run_manifests da160. Recibos e verificações usam context_manifest_verifications. Manifestos/observações mantêm os guards de imutabilidade e vínculos da04.

Nenhuma atualização retroativa reclassifica ou reescreve manifestos antigos. Ausência de manifesto continua legacy; manifesto04 sem contextCompilation mantém modo de composição antigo. Novo manifesto filho usa o parent/turno do mesmo run conforme CAS já existente.

Migrations157/158/159/160 permanecem byte a byte preservadas. Não foram aplicadas em bancos reais nesta etapa. A existência dos arquivos não comprova instalação operacional; verificar e aplicar futuramente exige autorização separada.

## 17. Consulta e observabilidade

Mantido GET /execution/context/:queue/:id, autorizado por card/projeto/workspace/runtime/ator. Posse de runId não autoriza acesso. GET continua somente leitura; não executa provider nem grava observações.

Quando metadata existe, compilation apresenta schema_version, policy_version, budget, compiled_hash, fingerprint, metrics, sections/absent_sections e warning_count. Não expõe o texto compilado, corpos de fontes ou a configuração arbitrária completa.

Verificações podem mostrar allowlist de delivery: boundary, hashes context/prompt/compiled/envelope, policy/estimator, estimativas de volume e limites de garantia. checkoutOwner, caminhos físicos, prompt bruto e metadados arbitrários não são retornados.

last_verification_status continua separado da observação live. API de prompt reobserva parcialmente e não inventa compatible para dimensões não observadas; API genérica pode reconstruir com política do manifesto. Terminal sem verificação final não herda automaticamente aprovação inicial. Nenhum indicador UI novo foi necessário/implementado; nove variantes preservadas.

## 18. Testes C1–C20

Comandos e grupos reproduzíveis, após preparar env sintético:

```sh
# U: testes puros e regressões unitárias listadas em§19, via loader do DEV
TSX_DISABLE_CACHE=1 TSX_TSCONFIG_PATH=/home/meada/projetos/orbit/forge/app/apps/api/tsconfig.json node --import ./forge/app/node_modules/tsx/dist/loader.mjs --test forge/app/apps/api/src/execution/context-compiler.spec.ts forge/app/apps/api/src/execution/context-compiler-host.spec.ts forge/app/apps/api/src/execution/context-delivery.spec.ts forge/app/apps/api/src/execution/context-manifest.spec.ts forge/app/apps/api/src/execution/context-registry.spec.ts forge/app/apps/api/src/execution/context-runtime.spec.ts
# W0: classes reais, composição legada
node --test tools/orbit/context-workers.test.mjs
# W1: modo compilado em subprocesso com env allowlist
node --test tools/orbit/context-compiler-workers.test.mjs
# P: adaptadores reais e stdin da CLI fake
node --test tools/orbit/context-compiler-provider.test.mjs
# SQL: PostgreSQL16 próprio, sem DATABASE_URL de produto
node --test tools/orbit/context-manifests.postgres.test.mjs
```

Esses comandos não devem herdar credenciais. As execuções desta entrega usaram Node24.20.0 absoluto, HOME temporário, CODEX_HOME sintético, CODEX_BIN inexistente/fake, env allowlist sem DATABASE_URL/PG*/chaves, hooks/fsmonitor Git desativados e TSX_TSCONFIG_PATH absoluto para subprocessos que trocam cwd. As fixtures que precisam de CLI usam binário Node próprio e home adapter fake. As suítes PG/ownership foram executadas sem concorrência com as outras suítes de workspace.

| Cenário | Status | Método/arquivos/evidência efetiva | Limitação |
| --- | --- | --- | --- |
| C1 |PASS |U/compiler24: JSON canônico, timestamps operacionais e run não semânticos, mesma política/material produzem fingerprint igual. |Não é equivalência semântica de textos diferentes. |
| C2 |PASS |U/compiler24 e U/registry: orçamento suficiente inclui blocos obrigatórios completos; tail além de64KB é preservado. |Estimativa conservadora, limites de leitura existentes continuam. |
| C3 |PASS |U/compiler+registry; W1 ambos enqueues bloqueiam quando mandatory não cabe, sem manifest/provider novo. |PG do harness de filas é fake. |
| C4 |PASS |U/compiler limites/excerpts; W1 omite história opcional com fonte/hash/motivo e mantém instrução atual. |Sem resumo automático. |
| C5 |PASS |U aliases equivalentes; W1 comentários históricos idênticos deduplicados, métricas removidas positivas. |Não mede economia faturável. |
| C6 |PASS |U versões, trust e proveniência distintos preservados. |Não escolhe versão semanticamente correta. |
| C7 |PASS |U mesma identidade/versão com hashes diferentes gera aviso e preserva os dois. |Não detecta toda contradição em linguagem natural. |
| C8 |PASS |U corpo malicioso não muda rótulo do renderer; U/runtime actions não recebem callback de atestação. |Separação estrutural não é sandbox universal. |
| C9 |PASS |W1 duas filas bloqueiam drift antes de provider/executor; política alterada impede queued run. U captura/revalidação. |Não cria atomicidade FS+PG. |
| C10 |PASS |W1 drift durante execução mantém output/success e registra contexto changed separadamente, duas filas. |SQL do pipeline é simulado. |
| C11 |PASS |W0/W1 retry retorna run/manifesto/compilação originais mesmo com modelo/config/política posteriores. |RBAC continua obrigatório. |
| C12 |PASS |U/manifest/registry e W1 edição durante execução conserva captura antiga/revisão e resultado. |Demanda não versiona todo projeto. |
| C13 |PASS |W1 duas filas com worktrees detached reais de fixtures, pin e fontes da raiz aprovada; origem intacta. |Provider/DB fake, sem worktree no Git real. |
| C14 |PASS |U/compiler fonte compartilhada selecionada afeta dependentes e U/registry detecta revisão de card relacionado alterada. |Sem grafo semântico automático. |
| C15 |PASS |U/registry/compiler e W1 arquivo externo não selecionado não invalida contexto. |Arquivo de configuração selecionado é unidade conservadora. |
| C16 |PASS |W1 resposta compatível mantém sessão/filho imutável; fontes/política incompatíveis não consomem provider nem apagam pergunta. |Memória/CLI reais não homologadas. |
| C17 |PASS |U compiler puro e regressão registry real com AI disabled. |Não autoriza chamar executor IA quando plugin indisponível. |
| C18 |PASS |U quatro dimensões de escopo; W1 API recusa ator/runtime fora do recurso e não retorna corpos/raízes. |Configuração operacional de bancos precisa manter isolamento. |
| C19 |PASS |W0 legado, W1 novo modo nas duas filas; ativar flag depois do enqueue mantém material legado. |Nenhum ambiente operacional foi ativado. |
| C20 |PASS |U/W/P/PG/regressões01–04 com fake quota/HOME/CLI e PG16/Git próprios;4 APIs e shared inspector. |Gate global continua BLOCK anterior; não é suíte global/operacional. |

Todos os cenários exigentes foram executados dentro desses alcances. Os20 rótulos não são contados como20 testes extras. Logs locais: /tmp/orbit05-audit-3ji6otsa, com relatórios Node; o Markdown conserva contratos/comandos sem depender da retenção desses temporários.

## 19. Testes de regressão

| Grupo efetivamente executado | Resultado final distinto |
| --- | ---: |
| U completo:compiler24+host3+delivery3+manifest23+registry12+runtime5+34 regressões unitárias anteriores |104 PASS |
| W0 context-workers legado |10 PASS |
| W1 context-compiler-workers, cenários filhos |17 PASS |
| W1 wrapper de orquestração, separado dos filhos |1 PASS |
| P context-compiler-provider, dois adaptadores no mesmo teste |1 PASS |
| Tools shared/preflight/catalog/registry-foundation/card-revision-ui/card-version-enqueue/card-revisions.postgres/workspace-coordinator.postgres/workspace-workers |75 PASS |
| Context PostgreSQL160 |10 PASS |
|03B isolated-checkout16, isolated-provider1 e isolated-workers1 |18 PASS |
| Prompt selecionado nos quatro runtimes:6 DEV+5 PROD+5 Safdoulas+5 Suindá |21 PASS |
| **Total, sem contar reexecuções** |**257 PASS,0 FAIL finais,0 skipped** |

As quatro APIs passaram tsc --noEmit --incremental false. Não houve mudança Web nem compilação/homologação visual nova. Os34 testes unitários anteriores incluem execution6/card-contexts4/isolated-policy1 e escopo/managed/checks/coordinator/supervisor23.

Comandos adicionais executados:

```sh
node --test tools/orbit/shared.test.mjs tools/orbit/preflight.test.mjs tools/orbit/catalog.test.mjs tools/orbit/registry-foundation.test.mjs tools/orbit/card-revision-ui.test.mjs tools/orbit/card-version-enqueue.test.mjs tools/orbit/card-revisions.postgres.test.mjs tools/orbit/workspace-coordinator.postgres.test.mjs tools/orbit/workspace-workers.test.mjs
node --test tools/orbit/isolated-checkout.test.mjs tools/orbit/isolated-provider.test.mjs tools/orbit/isolated-workers.test.mjs
node <runtime>/app/node_modules/typescript/bin/tsc --noEmit --incremental false -p <runtime>/app/apps/api/tsconfig.json
TSX_TSCONFIG_PATH=<absoluto-do-runtime>/apps/api/tsconfig.json node --import ./<runtime>/app/node_modules/tsx/dist/loader.mjs --test --test-name-pattern='prompt queue|revision|disabled AI startup|Questionar|multi_agent' <runtime>/app/apps/api/src/prompt-question.spec.ts
```

O U completo também executou execution.spec, card-contexts.spec, isolated-execution-policy.spec, file-scope.spec, managed-process.spec, project-checks.spec, workspace-coordinator.spec e workspace-process.spec do DEV. Em cada comando que usa fixtures, aplicar o env seguro descrito em§18.

Falhas/intercorrências intermediárias preservadas nos logs, corrigidas e repetidas:

- Harness escolhia o primeiro manifesto ao validar texto do turno filho; passou a selecionar o último turno. Seu modo de pergunta também passou a ser explícito, independente dos cenários novos anteriores.
- Bloqueio de material compilado ocorre antes do erro legado de fonte; o teste passou a exigir a mensagem correspondente ao modo efetivo, mantendo a obrigação de rejeição e preservação de histórico.
- Declaração de compilerPolicy no catch não era reconhecida como definitivamente atribuída pelo TypeScript; inicialização explícita preservou o fail-closed e as4 compilações passaram na repetição final.
- Texto longo expôs custo de backtracking da redação; a correção mantém padrões sensíveis e conteúdo obrigatório. O U final104 passou em cerca de6s, sem repetir a demora inicial de cerca de82s. Não se apresenta esse caso sintético como redução geral de tempo do produto.
- O runner de regressões herdava TSX_TSCONFIG_PATH relativo e uma fixture mudava cwd; corrigido no ambiente de teste para caminho absoluto, sem alterar o código da fixture ou ocultar falha do produto.

Não executados: npm test global; browser; workers implantados; Codex/sandbox reais e protocolos pagos; embeddings; migrations/bancos de produto; benchmark faturável de tokens. Nenhum desses itens foi contado como PASS.

## 20. Monorepo e projeções

Core final **1.8.2**,197 mappings, integridade **b9df86101ec8fdd0abfea20598557af325d0fffc78fdf66f3a01e701d6f01ad9**. UI permanece1.1.3/74, integridade8b8cc6ed2f02d2792da0787193cf0062801623c568e22f4804ee489c87ccdff8.

Fluxo oficial: planejamento e publicação selecionada somente @orbit/core-source.1.8.0 integrou os contratos e mappings;1.8.1 acrescentou teste de material longo e registro de política incompatível;1.8.2 fechou a redação sem backtracking e sua regressão. Planos/precondições/resultados foram registrados, sem editar hashes de locks manualmente.

Conferência final: **0 drift Core,0 locks pendentes**. As296 projeções UI e seus hashes canonical/actual/locked foram comparados ao preflight inicial, preservados. As nove variantes anteriores não foram apagadas. Preflight global permanece BLOCK pelas condições anteriores; não há alegação de gate verde ou promoção operacional aprovada.

Diferenças de prompt/provider/architecture dos produtos foram preservadas mediante patches locais. Não houve cópia integral de DEV sobre Safdoulas/Suindá, branch por ambiente, repositório interno ou sincronização global de UI.

## 21. Segurança operacional

Os testes foram revistos antes de executar. Nenhum entrypoint de bootstrap real, consulta real de quota, autenticação real ou provider pago foi utilizado.

- Compiler/testes puros importam contratos e crypto, sem FS/DB/provider.
- Harness das filas usa classes/registry/coordinator reais, fake DB, quotas substituídas, executores/provider fake, Git mkdtemp e worktrees exclusivamente desses repositórios.
- Wrapper opt-in faz spawn com env allowlist; nenhum DATABASE_URL/PG*/API key/CODEX auth é herdado.
- Teste de entrega usa CLI Node fake absoluto. CodexAiService.codexHome é substituído por HOME da fixture; CodexExecutor é transpile-loaded com substituição apenas do adapter prepareOrbitCodexHome. Portanto não toca .orbit/sessions real nem auth do host. stdout/stdin reais da CLI fake são comparados ao recibo.
- PostgreSQL16 usa cluster descartável/socket privado/listen_addresses vazio, prova de data_directory/usuário/versão/inet_server_addr antes de DDL e teardown só da instância própria. Testes não usam DATABASE_URL de produtos.
- Hooks/fsmonitor/config Git global/system foram bloqueados; Git mutável existe só em fixtures. Nenhuma worktree foi ligada ao repositório Orbit real.
- Nenhuma limpeza de quarentena/worktree operacional. Não houve comando Docker, deploy, restart, seed, migration real, commit/push/tag/reset/clean/restore/stash/checkout forçado no Orbit.

Um pedido de término de PID de teste, após investigar a demora, encontrou o processo já encerrado e não sinalizou nenhum processo. Serviços reais não foram usados como evidência de implantação. Eventual reação de hot reload a arquivos não equivale a ativação homologada.

Houve delegação com escopos independentes (compiler puro, integração genérica, revisão/testes). Os contratos e resultados foram integrados/revistos pelo agente principal. Após limites de uso das frentes, o integrador concluiu correções e evidências; não há medição que permita afirmar economia total de tokens/tempo por delegação.

## 22. Inventário Git

Baseline1420 arquivos: **66 modificados nesta etapa,0 removidos**. Novos05: **33 arquivos** (6 fontes canônicas+24 projeções+2 ferramentas de teste+este relatório). Os deltas contra HEAD incluem trabalho anterior e não devem ser atribuídos integralmente à05.

Os66 modificados são9 fontes canônicas e36 projeções;12 arquivos nongeneric de runtime (prompt/provider/architecture);AGENTS/experiência;package/workspace e4 locks;1 harness de tools. A tabela de§12 enumera todas as famílias e seus caminhos. Os6 mappings novos são compiler.ts/spec, compiler-host.ts/spec e delivery.ts/spec.

Comparação de hashes preservou migrations157–160, context-manifest.ts/spec, ProjectRegistry, RunRepository, coordinator/process/supervisor/checkout/isolated-policy/file-scope, relatórios anteriores, UI e alterações de produto anteriores. Arquivos preexistentes que receberam delta05 estão declarados em§12, sem atribuir sua totalidade a esta entrega.

Inventário/status/planos finais foram registrados no diretório de auditoria local. main/HEAD permaneceram os mesmos; arquivos continuam locais, incluindo fontes novas ainda não rastreadas. Não se declarou publicação Git remota.

## 23. Limitações e riscos

1. Byte-bound é estimativa conservadora do texto controlado; pode omitir mais documentos que um tokenizer específico. Não é dado faturável nem benchmark financeiro.
2. Memória de sessão, AGENTS implícitos do CLI, ferramentas, leituras futuras e imagens não são integralmente limitados pelo compiler. Uma janela declarada por env requer evidência externa antes de virar garantia operacional.
3. O host deve classificar código/estrutura como structured e só fornecer excerpts documentais explicitamente autorizados; o compilador não faz interpretação semântica universal.
4. Fontes selecionadas omitidas podem continuar causando incompatibilidade quando mudam, porque ainda fazem parte da seleção/proveniência capturada. Arquivos não selecionados não são invalidados por descoberta arbitrária.
5. Hash não é aprovação, autorização ou resolução de conflitos. Rótulos estruturais não garantem obediência de qualquer modelo.
6. Preparação filesystem/SQL não é transação atômica conjunta; revalidação diminui riscos sem eliminar toda janela externa.
7. Persistência mantém hashes/metadados, não arquivo histórico completo de toda fonte. Retenção/privacidade continua sendo política explícita futura.
8. Fontes dinâmicas sem observador autorizado não ganham validade por recompilação. API de prompt pode informar unverified.
9. Checkout/coordinator conservadores03A/03B não são sandbox universal; processos externos não cooperantes e isolamento Linux real não foram homologados aqui.
10. Limites anteriores de leitura e skillPrompt (60KB) ainda podem bloquear uma entrada antes do compiler. O novo modo não transforma essa falha em truncamento/sucesso silencioso nem promete acomodar qualquer documento.
11. Resposta de pergunta que altera a seleção de material compartilhado por orçamento pode exigir nova execução; não se migra memória automaticamente.
12. Substrato aditivo não significa implantação ou compatibilidade de todas as versões históricas possíveis dos plugins. Os contratos e combinações efetivamente validados são os registrados nesta entrega.

## 24. Pendências de ativação

A05 não requer migration adicional. Migrations157–160 de etapas anteriores ainda exigem comprovação/aplicação em cada banco, quando houver autorização específica. Não presumir instalação a partir deste relatório.

Para futura homologação autorizada:

1. Verificar schema, backups, isolamento e configuração de cada runtime sem compartilhar dados.
2. Confirmar contratos Core/plugins e condições históricas do preflight, sem apagar variantes UI.
3. Configurar ORBIT_CONTEXT_COMPILER_ENABLED=1 em apenas um ambiente escolhido e revisar os limites/política do host. Nenhum arquivo .env foi alterado nesta entrega.
4. Demonstrar orçamento real do executor/modelo, envelope, quotas, imagens e comportamento de sessão; defaults não provam capacidade paga.
5. Validar funcionalmente criação, espera, drift, pergunta/resposta, cancelamento, worktree e consulta autorizada com dados de homologação.
6. Decidir ativação dos outros ambientes separadamente, preservando dados/produtos e mantendo o modo capturado dos runs anteriores.

Flags disponíveis, todas host-only: ORBIT_CONTEXT_COMPILER_ENABLED; sufixos MAX_ESTIMATED_TOKENS, RESERVED_RESPONSE_TOKENS, RESERVED_OPERATION_TOKENS, RESERVED_EXTERNAL_TOKENS, SAFETY_MARGIN_RATIO, DOCUMENT_MAX_ESTIMATED_TOKENS, HISTORY_MAX_ESTIMATED_TOKENS, PER_RESOURCE_MAX_ESTIMATED_TOKENS, PROVIDER_CONTEXT_WINDOW sob prefixo ORBIT_CONTEXT_COMPILER_. Formato ambíguo/número inválido falha fechada. Configuração do projeto/prompt não concede opt-in.

Sem deploy/restart/migration real nesta etapa. Nenhuma autorização de ativação é inferida da distribuição dos arquivos.

## 25. Preparação para a próxima etapa

| Componente futuro, não implementado | Ponto real disponível/limite |
| --- | --- |
| Context Bridge |Fontes/manifestos/compilationMetadata e DTO autorizado; ainda sem sincronização bidirecional ou ingestão confiável. |
| MCP |Consulta existente com RBAC e recibos; nenhum servidor/tool/protocolo novo autorizado. |
| RAG compartilhado |Blocos selecionados e orçamento reutilizáveis; BM25/vetor atuais mantidos nos escopos existentes, sem índice universal. |
| Knowledge Reconciliation |Conflitos determinísticos e histórico preservado; nenhuma resolução/aprovação semântica. |
| Project Consistency Engine |Intenção/revisão/seleção/compilação/observação separadas; faltam regras semânticas e validação de resultado. |
| Integration Gate |Hashes de contexto/material e evidências03B disponíveis; sucesso continua diferente de integração autorizada. |
| Desired State Reconciler |Histórico imutável e freshness para consumo futuro; nenhuma alteração automática de código a partir de estado desejado. |

Não foi iniciada a06 nem qualquer dessas capacidades.

## 26. Handoff técnico

Começar pela fonte canônica packages/orbit-core/src/execution/context-compiler.ts, helperhost, delivery, ContextBuilder, CardExecutionService e PromptSessionsService de cada runtime. O manifesto/SQL160 permanecem os da04. Consultar os testes e este relatório antes de alterar significados de hashes ou modo legado.

Exemplo mínimo do contrato puro:

```ts
const compilation = compileContext({
  identity, // host-authenticated ContextManifestIdentity
  sources: authorizedSources,
  blocks: [{id:'task',section:'task',sourceIds:['card:authorized-id'],text:observedDemand,required:true}],
  policy: defaultContextCompilerPolicy(),
});
if (compilation.status !== 'ready') throw new Error('Context compilation blocked');
// Persist this metadata inside the immutable04 manifest configuration.
const metadata = compilationMetadata(compilation);
// Deliver compilation.text exactly. compiledHash hashes this text, not the provider envelope.
```

Identidade/sourceIds precisam corresponder ao recurso autorizado; o exemplo não é um endpoint que aceite identidade escolhida pelo usuário. ContextCompilerPolicyFromHost decide novas execuções; compilerPolicyForManifest escolhe o modo histórico e recusa mudança de política em compilados. No legacy esse helper retorna null mesmo com flag atual ligada.

O adaptador recebe ContextDeliveryContract={compiledHash,policy,onDelivery?}. prepareContextDelivery(compiledText,envelope,contract) verifica o hash, presença exata e limites do envelope; callback persiste observação antes do envio. Esse callback é interno e removido do input entregue a plugins. Recibo não afirma recebimento por rede/modelo nem memória integral, só a fronteira stdin controlada pelo Orbit.

Para repetir checks, usar env sintético de§18, Node24, loaders/tsconfigs absolutos, Git/PG próprios e suites direcionadas de§19. Não executar onModuleInit/claim/finish de quotas reais nem reaproveitar DATABASE_URL/CODEX_HOME/autenticação do host. Não usar npm test global sem auditar efeitos.

Publicar alterações compartilhadas por shared reconcile --packages @orbit/core-source --release <patch|minor> --files <todas-as-fontes-atribuídas>, primeiro plano, depois --write e nova inspeção. Não editar projeções/locks isoladamente, não sincronizar UI global e não criar branches por ambiente.

Core1.8.2/API1.0.0/PluginAPI1;197 mappings. Migrations existentes157–160, nenhuma161 desta etapa. Flags continuam defaultoff nos ambientes. Preservar diferenças nongeneric de Safdoulas/Suindá e o namespace orbitContextRuntime próprio.

## 27. Resultado final

**CONCLUÍDA no escopo de código, testes isolados e distribuição em arquivos da Implementação05.**

| Dimensão | Estado |
| --- | --- |
| Código e contratos |Compiler puro, typed blocks reais, budget/dedup/trust/omissões, dois pipelines, sessões e atestação de entrega implementados. |
| Testes |257 distintos aprovados,0 falhas finais,0 ignorados;C1–C20 PASS no alcance descrito;4 APIs compiladas. |
| Fontes/projeções |Core1.8.2/197 mappings,0 drift Core/locks;UI1.1.3 e9 variantes preservadas. |
| Banco real |Sem consulta/migration/alteração. Nenhuma migration05 nova; etapas157–160 exigem verificação/ativação autorizada. |
| Ativação |Não realizada;flag padrãooff,nenhuma mudança .env. |
| Homologação operacional |NOT_RUN:provider/memória/sandbox reais,workers implantados,bancos/imagens/limites pagos e UI funcional. |
| Git/serviços |Sem stage/commit/push/tag ou restart/deploy;main/HEAD e trabalho anterior preservados. |
| Próxima etapa |Não iniciada;sem MCP/RAGnovo/reconciliação semântica/merge/integração automática. |

A conclusão não afirma economia financeira observada, memória semântica unificada, gate global aprovado ou implantação dos ambientes.
