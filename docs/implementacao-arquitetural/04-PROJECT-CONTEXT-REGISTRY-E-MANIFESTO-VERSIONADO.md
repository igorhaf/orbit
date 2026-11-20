# Implementação 04 — Project Context Registry e manifesto versionado

Data de fechamento: 2026-11-14, America/Recife. Repositório: `/home/meada/projetos/orbit`.

**CONCLUÍDA no escopo de código, testes isolados e distribuição em arquivos.** Core fonte final **1.7.7**, API Core **1.0.0**, Plugin API **1**. Bancos reais não foram consultados ou migrados; não houve comandos de implantação/reinício. Homologação operacional permanece separada.

## 1. Resumo executivo

A camada determinística existente de projetos foi estendida para identificar as fontes selecionadas, sua proveniência, escopo, conteúdo observado e versões disponíveis. As duas filas passam a vincular o contexto preparado a manifestos imutáveis por run/turno. O worker revalida fontes, autorização, revisão, estado técnico e material antes de executar; mudanças posteriores geram observações separadas, preservando o manifesto e o resultado técnico.

O mecanismo distingue intenção vigente, estado observado e contexto entregue. A revisão da demanda continua independente da atualidade do contexto, do status da execução e da integração de código. Não foi implementada memória semântica, reconciliação de negócio, RAG novo, Context Bridge, MCP ou Integration Gate.

A consulta autenticada `GET /execution/context/:queue/:id` informa fontes, hashes, fingerprint, revisão/base, histórico e uma observação atual possível. O resultado distingue a última verificação persistida da comparação somente de leitura realizada no GET. Fontes que o observador parcial não consegue revalidar ficam **unverified**, sem inventar compatibilidade. Corpos de prompts/documentos, caminhos físicos e provenance arbitrária não são publicados nesse DTO.

Resultado final: **214 testes distintos aprovados, zero falhas finais, zero ignorados; quatro APIs compiladas**. Inclui PostgreSQL16 descartável, classes reais das duas filas com dependências externas simuladas, worktrees reais de fixtures, sessões/Q&A, autorização e regressões01–03B. Não houve chamada real ao Codex ou a modelos/embeddings pagos. O gerador foi ajustado para atribuir namespace de contexto próprio a produtos novos e manter o perfil necessário ao runtime.

## 2. Base documental

A equipe leu integralmente os relatórios00–20 e as implementações01/02/03A/03B durante esta sequência de trabalho, incluindo adendos. A04 foi confrontada com o **relatório final**03B, não com o rascunho. O código atual e as verificações desta entrega determinam os resultados; relatórios anteriores são histórico.

| Base | Consequência aplicada |
| --- | --- |
| 00–02 | Reusar monorepo, dois pipelines, dados isolados e capacidades existentes; inventário não equivale a homologação. |
| 03–05 | Preservar filas, logs, permissões, sessões e adaptadores; não criar terceira fila ou provider. |
| 06–09 | Separar intenção de evidência, localizar contratos atuais e preservar variantes dos produtos. |
| 10–11 | Card revision, prompt, sessão, Git e checkout são identidades distintas; snapshot antigo não se torna atual por receber um ID novo. |
| 12–13 | Progresso/Q&A não é bridge; hashes/retrieval não são memória reconciliada ou aprovação semântica. |
| 14–16 | Reaproveitar ProjectRegistry, ContextBuilder, plugins e verificações; não promover filesystem/checks a um reconciliador global. |
| 17–19 | Concorrência, assimetria das filas, CAS e rollback exigem testes próprios; Git/PG só em fixtures descartáveis. |
| 20 | Autoridade de identidade/permissão/versão é do host/Core. O consumidor vetorial do Suindá já existe e foi preservado, sem integração global automática. |
| Implementação01 | Preflight somente leitura e publicação selecionada, com precondições e proteção de drift. |
| Implementação02 | Migration157, revisão monotônica, snapshot da demanda, CAS/freshness/idempotência mantidos. A continuação§18 já corrigiu a aspa do painel docente Suindá. |
| Implementação03A | Coordinator/supervisor/ownership/quarentena mantidos; incidente histórico de consulta real de quota não pode se repetir. |
| Implementação03B final | Core inicial1.6.2, worktrees opt-in, pin no enqueue,159, evidências not_integrated, Q&A no mesmo checkout e common-dir serializado preservados. |

Também foram consultados AGENTS, skill `orbit-environment`, documentação de aceleração/experiência de produto, workspace/pacotes/locks, registries, contratos e ferramentas oficiais. Esta é uma tarefa direta no ambiente de desenvolvimento, sem card/context.write_scope fornecido para a sessão. Isso não concede autorização operacional.

## 3. Estado inicial

Branch `main`; HEAD `d9307b8e6a54316f802acbd7bcb96baa26116f16`, preservados. Core fonte1.6.2/185 mappings; UI1.1.3/74. A árvore já continha01/02/03A/03B não commitadas, suas projeções, migrations157–159, testes, relatórios e ZIP. Nenhum desses conjuntos foi descartado ou reiniciado.

O preflight inicial somente de leitura foi salvo em `/tmp/orbit04-audit-gfc7jh_k/preflight-initial.json`. Um baseline de **1360 hashes** cobriu fontes/projeções compartilhadas e arquivos locais modificados/não rastreados; não continha artefatos04. O status inicial registrava179 entradas, incluindo diretórios não rastreados agregados pelo Git. Isso não é um commit limpo nem uma lista individual de todos os arquivos desses diretórios.

Permaneciam nove drifts UI: codex-limits e plugin-navigation nos quatro runtimes, mais access-shell Safdoulas. Não havia drift core ou lock pendente no pacote1.6.2. A expectativa textual antiga de tema Suindá é pendência histórica separada, sem nova falha visual comprovada.

157/158/159 haviam sido aplicadas somente em testes descartáveis. O estado dos bancos reais não foi consultado nesta04. A migration livre seguinte era160; não se presume implantação a partir da existência de SQL ou de um relatório.

## 4. Arquitetura anterior

ProjectRegistry já autorizava projeto por owner, resolvia root/.orbit, configuração YAML, documentos, agentes/skills e hashes. ContextBuilder montava prompt/resources/workingDirectory; PromptSessionsService possuía outro fluxo, com skills, referências, checklists, imagens e histórico. Os dois builders não possuíam um manifesto comum imutável do conjunto efetivamente preparado.

A02 fixava a revisão da demanda, não o contexto completo. A03A fornecia coordenação física/supervisão, não proveniência global. A03B associava checkout, SHA e alterações por run, mas seu fingerprint era de **alterações Git**, não de contexto. Sessões tinham guards de revisão/checkout, sem validação das demais fontes selecionadas.

A04 acrescenta contratos e observações a esses componentes. Não substitui seu domínio, não altera o modelo de plugins nem afrouxa locks/rollback.

## 5. Decisões arquiteturais

1. Evoluir ProjectRegistry/ContextBuilder e preservar a composição existente, acrescentando fontes e verificação. Não criar repositório de conhecimento paralelo.
2. Persistir metadados/hash, não copiar indiscriminadamente os corpos selecionados. Prompt/output já existentes nas filas mantêm seu contrato; manifesto não é arquivo universal de conversas.
3. Manifesto imutável por turno. Resposta autorizada gera filho no mesmo run, com parent e CAS; nunca reescreve o pai.
4. Revalidar composição e início, admitindo que filesystem e transação PG não formam snapshot atômico. Falha fecha a execução, sem atribuição retroativa.
5. Preservar o material preparado; não substituir silenciosamente um prompt antigo por fontes novas.
6. Separar atualidade de contexto da revisão da demanda. Hash persistido não implica compatible.
7. Retomada entre runs é conservadora: sessão nova quando compatibilidade histórica não foi comprovada. Q&A do mesmo run permite delta explícito de resposta/sessão, mantendo dependências comuns verificadas.
8. Autorização por recurso antes da consulta; runtime/ator/projeto/workspace fazem parte do escopo. Namespace do runtime é configuração do host, não texto do prompt.
9. GET não adiciona verificações. Estado atual parcial permanece unverified; última evidência persistida conserva tempo e significado próprios.
10. Manter03B opt-in, common-dir serializado e efeitos externos bloqueados. Manifesto não aprova integração ou amplia permissões.

## 6. Project Context Registry

O serviço continua sendo `ProjectRegistry` em `packages/orbit-core/src/execution/project-registry.ts`. Foram acrescentados:

| Método/estrutura | Responsabilidade |
| --- | --- |
| contextSource | Define scope/owner/observedAt a partir do host e recurso selecionado. |
| documentSource | Identifica agente/skill/rule/knowledge por caminho lógico, hash de corpo entregue e rawHash de leitura. |
| fileSource | Lê somente seleção explícita com readResource/safePath; normaliza caminho lógico; ausência opcional é representada com rawHash:null. |
| configurationSource | Registra configuração observada e detecta troca entre leitura de configuração e montagem. |
| observeSelection | Relê fontes selecionadas e preserva identidade histórica sem tratá-la como vigente. |
| assertSelectionUnchanged | Detecta corrida de conteúdo/metadata/configuração durante a montagem. |
| revalidateSelection | Reautoriza owner/root e reobserva arquivos/cards/host disponíveis; tipos não reobservados são unverified. |
| Project.authorizationRoot | Mantém origem autorizada quando root/resourcesRoot são remapeados para a worktree aprovada pelo host. Não é um token ou sandbox contra código arbitrário. |
| contextWarnings | Separa configuração fatal de avisos de catálogo sobre documentos não selecionados. |

`ContextSource` schema1 registra id/type/origin/resourceId/ownerId, scope(runtimeId/projectId/workspaceId/actorId), version/contentHash, availability, required, selectionReason, dependencies, trust, observedAt e provenance quando aplicável. Trust admite documental/host_policy/observation/historical/hypothesis/result; nenhum rótulo concede acesso ou inventa aprovação humana.

Documentos sem revisão de domínio verificável mantêm version nulo e identidade de conteúdo por hashes; não recebem SemVer histórica fabricada. Cards relacionados usam card_revision real. Escopo e autorização não são substituídos por URL/path/hash.

Não se varre o repositório inteiro. A enumeração .orbit existente é limitada; a04 registra apenas recursos consumidos. Documento não selecionado, inclusive YAML malformado, pode continuar como aviso no catálogo sem invalidar outro contexto. Ambiguidade de ID selecionado falha de forma controlada.

## 7. Manifesto versionado

`context-manifest.ts` define ContextJson/ContextObject, ContextScope/ContextSource, ContextManifestIdentity, CreateContextManifestInput, ContextManifest, CurrentContextObservation, ContextCompatibility e os envelopes persistidos.

O manifesto inclui schemaVersion1; queue/run/card/revisão/projeto/workspace/ator/runtime/executor/executionType; fontes ordenadas; configuration, git, checkout, assemblyPolicy; material(contextHash,promptHash); capturedAt, captureStatus, fingerprint e integrityHash.

- `createContextManifest` valida e copia JSON estrito, verifica escopos/IDs únicos e fontes obrigatórias, calcula hashes e congela a estrutura.
- `canonicalContextJson` ordena chaves de objeto e preserva arrays/Unicode. Rejeita undefined, NaN/Infinity, bigint, accessors, ciclos, protótipos customizados, símbolos e arrays ambíguos.
- `fingerprint` SHA256 inclui identidade semanticamente relevante, ordem/fontes/versões/escopos, configurações, estado técnico, política e material. Exclui runId e timestamps operacionais previstos; não serve como ID de run.
- `integrityHash` vincula o manifesto completo, inclusive run e captura. Não equivale a assinatura criptográfica contra administrador do banco.
- Optional missing comprovado pode ser captured/compatible se continuar ausente; required missing/unavailable/unverified bloqueia criação válida. Ausência não vira conteúdo fictício.
- `compareContextManifest` produz captured/unverified/compatible/changed/unavailable/legacy conforme evidência, não aprovação semântica.

Timestamps de observação não alteram o fingerprint semântico. Mudanças reais em bytes/versionamento/proveniência selecionados o alteram. Fontes extras não relacionadas não o invalidam por si; material/configuração/seleção relevante também são comparados pelos consumidores, evitando anexar fontes novas silenciosamente.

Q&A usa turn0 e filhos turn1..N, preservando pai/fingerprint. A intenção do novo turno é explícita; fontes comuns precisam continuar compatíveis.

## 8. Implementação arquivo por arquivo

Caminhos relativos à raiz. As projeções abaixo são geradas pelo fluxo oficial.

| Arquivo/família | Responsabilidade anterior → alteração; justificativa/consumidores/compatibilidade/risco |
| --- | --- |
| packages/orbit-core/src/execution/context-manifest.ts | Novo contrato puro, canonicalização, hashes, comparação e repository. Consumido por registries/workers/API; sem provider/Db concreto. Chamadores devem fornecer observações completas para as dimensões que pretendem verificar. |
| packages/orbit-core/src/execution/context-manifest.spec.ts |23 testes puros de determinismo, histórico, escopo, ausências, turnos e repository fake. Não prova SQL ou RBAC da API. |
| packages/orbit-core/src/execution/context-runtime.ts | Novo adaptador do host: observação Git read-only, identidade, fontes de plugins, vínculo material, receipts, checks finais e DTO seguro. Não é Context Compiler ou sandbox. |
| packages/orbit-core/src/execution/context-runtime.spec.ts |3 testes de scope operacional, verificação final perdida e plugin desativado/contrato alterado. Não faz chamadas externas. |
| packages/orbit-core/src/execution/context-registry.spec.ts |11 testes de fontes/raças/escopos/worktree/unrelated/default executor. Usa FS temporário e DB mock. |
| packages/orbit-core/sql/migrations/160_context_manifests.sql | Novas tabelas e guards de imutabilidade/binding. Adição após159; requer ativação futura, sem modificar migrations anteriores. |
| packages/orbit-core/src/execution/project-registry.ts | Mantém get/document/skillPrompt; acrescenta proveniência/seleção/revalidação, authorizationRoot e warnings separados. Métodos são internos do host; não são uma autorização autônoma para raiz arbitrária. |
| packages/orbit-core/src/execution/context-builder.ts | Mantém texto/resources/skills/cwd/executor; acrescenta sources/configuration/assemblyPolicy e releitura selecionada/cards. Hash da configuração usa executor efetivo para evitar drift null/default. |
| packages/orbit-core/src/card-contexts.ts | Retorno/SQL passam a incluir revisão/workspace; GROUP BY ajustado. Formato textual de referência preservado; autorização continua por recurso. |
| packages/orbit-core/src/execution/run-repository.ts | Input aceita context_manifest_id; callback onInserted opcional une criação nova e manifesto na transação. Idempotência antiga retorna antes de callback; callers legados continuam reconhecidos. |
| packages/orbit-core/src/execution/execution.service.ts | Captura/revalida no enqueue, associa no callback, verifica antes de entregar e observa depois; acrescenta API por recurso. Entrada ao executor é construída depois do rebuild aprovado. Outputs não são descartados por drift final. |
| packages/orbit-core/src/execution/execution.controller.ts | Acrescenta GET de contexto para as duas filas, preservando endpoints atuais. Nenhuma nova fila/controlador paralelo. |
| {dev,prod,safdoulas,suinda}/app/apps/api/src/plugins/ai/prompt-sessions.ts | Deltas localizados: fontes reais da composição, pin, manifesto/turno/observações, contexto da sessão, checks/start/final e idempotência antes de modelos/configs atuais. Diferenças de cada produto preservadas. |
| {dev,prod,safdoulas,suinda}/app/apps/api/src/orbit-architecture.ts | Identidade runtime própria e orientação persistente de contexto sincronizada no prompt incorporado. Não é uma fonte compartilhada a ser sobrescrita por DEV. |
| {dev,prod,safdoulas,suinda}/app/apps/api/src/prompt-question.spec.ts | Fixtures explicitamente legadas usam seam de tracing desligado e quota/HOME fake; o caminho04 é testado separadamente com registries reais. Não há flag pública para desligar tracing por prompt. |
| tools/orbit/context-manifests.postgres.test.mjs | Novo PG16 efêmero com prova de identidade,160, imutabilidade e concorrência reais. Não carrega bootstrap/provedor/Db de produto. |
| tools/orbit/context-workers.test.mjs | Novo harness das duas classes/registries/coordinator reais, SQL/quota/provider fake, Git/FS/worktrees de fixtures reais;10 testes reportados. |
| tools/orbit/workspace-workers.test.mjs | Harness03A preserva foco em runs legados, com tracing seam explícito.04 não é simulada como aprovada nesse teste. |
| tools/orbit/isolated-workers.test.mjs | Harness03B usa ProjectRegistry real com lookup de autorização fake, para atender interface evoluída; continua cobrindo legado/isolamento. |
| tools/orbit/generate.mjs | Atribui orbitContextRuntime do produto com transformação registrada; recusa identidade ambígua/mapeada como fonte comum. Corrige ausência preexistente de gravação product.profile.json, detectada na verificação dirigida. |
| tools/orbit/generate.test.mjs | Fixture inclui identidade DEV; verifica namespace gerado, origem preservada, transformação e fluxo do perfil. Git mutável é só fixture. |
| packages/orbit-core/package.json e orbit.workspace.json | Seis mappings novos e versões oficiais1.7.0–1.7.7. Não alteram a versão da API Core1.0.0. |
| {dev,prod,safdoulas,suinda}/app/orbit.shared-lock.json | Somente entradas core atualizadas oficialmente. Entradas UI preservadas. |
| AGENTS.md e docs/product-experience.md | Regra de contexto/namespace e sincronização com prompt incorporado. |
| docs/implementacao-arquitetural/04-PROJECT-CONTEXT-REGISTRY-E-MANIFESTO-VERSIONADO.md | Este relatório autossuficiente. Não substitui relatórios históricos. |

Cada um dos seis novos mappings possui quatro projeções; cada uma das seis fontes comuns alteradas também foi projetada nos quatro runtimes. Não se editou apenas uma projeção nem se sincronizou UI globalmente.

## 9. Fontes de contexto

| Fonte | Proveniência/versão/seleção |
| --- | --- |
| Demanda do card | Título/descrição usados no snapshot, card_revision capturada e hash. Não recarimbar prompt antigo com revisão nova. |
| Cards relacionados | IDs ordenados, revisões reais, conteúdo e permissões atuais; herança/referências vivas resolvidas pelos helpers existentes. |
| Agente/skills/rules/knowledge | Documentos explicitamente selecionados pelas configurações/skills do agente, com logicalPath/rawHash/corpo redigido. Não se inclui toda a coleção automaticamente. |
| AGENTS.md | Somente quando selecionado no builder; primary/fallback/ausência opcionais explícitos. Não equivale a aprovação humana. |
| Arquivos selecionados | readResource/safePath, hash de leitura e material redigido. Sem varredura de caches/dependências/segredos. |
| Configuração do projeto | orbit.yaml no resourcesRoot, observação/hash e configuração efetiva. Seleção conservadora por arquivo/configuração, não análise semântica por campo. |
| Configuração de execução | Executor efetivo, permissões, skills/agent, scope, checks e seleção. Valores relevantes participam do hash; o manifesto não publica corpos secretos. |
| Contrato do host | orbitArchitecturePrompt/política de montagem identificados; hash detecta mudanças de texto. |
| Plugins | Somente dependências relevantes e seus pais/contratos atuais: versão, coreCompatibility/Core API, capabilities/actions/schemas e disponibilidade. Sem executar contribuição arbitrária. |
| Checklists/conversa/imagens | No fluxo de prompt, hashes dos dados efetivamente lidos/fornecidos; imagens por SHA256 dos bytes, sem expansão/cópia no manifesto. Conversa é histórica, não regra aprovada. |
| Instrução/turno/sessão | Delta explícito da resposta, histórico de pergunta e sessionBinding com hashes/parent fingerprint; identidade de sessão não prova memória integral reconciliada. |
| Git/checkout | SHA/ref quando verificados, identidade física/intent do checkout; worktree aprovada por03B; filesystem sem Git é marcado not_applicable/unborn, não commit fictício. |

Escopo versão1 é por runtime/projeto/workspace/ator. Referências que não cabem nesse escopo, inclusive compartilhamento entre workspaces sem contrato explícito representável, falham fechadas. Não foi implementado um sistema novo de concessão entre produtos.

## 10. Construção do contexto

ContextBuilder preserva seus blocos e devolve fontes do material realmente incorporado. SkillPrompt continua sendo usado pelo fluxo IA, agora com fontes/configuração/política adicionais. PromptSessionsService conserva makePrompt e coleta os dados que esse makePrompt usa: card, defaults/controles, skills, referências, checklists, imagens, conversa, instrução e políticas.

Há releitura de recursos/config/cards após composição e uma segunda observação antes de vincular. Fonte alterada/ambígua/obrigatória ausente impede a preparação válida. A transação protege vínculo de run/revisão/manifesto; **não torna o filesystem e PostgreSQL atomicamente consistentes**. Uma alteração após a última leitura ainda é possível e deve ser detectada no início/final, não ocultada com afirmação de snapshot global.

O materialHash refere-se à fronteira registrada: executor_input no genérico e codex_provider_execute_input no prompt. Inclui o texto efetivamente entregue nessa chamada. O envelope interno do CLI, leituras implícitas de AGENTS pelo CLI e toda a memória conversacional externa não são promovidos a um Context Compiler completo. Imagens/configuração/sessão possuem evidências próprias no conjunto/receipt.

O worker não recompila com novas fontes e executa silenciosamente. Reconstrói para comparar; só entrega material compatível. No genérico, a construção de ExecutionInput/resources foi movida para depois da reconstrução validada, eliminando possibilidade de receipt do texto novo com execução do texto antigo.

## 11. Integração com card_runs

Enqueue autoriza card/projeto/layout e recupera request-key existente antes de depender de configuração vigente para criar outro contexto. Configuração desativada depois não converte retry em novo run nem impede recuperar a associação original, respeitada a autorização do recurso.

Para run novo, captura estado técnico antes da composição, monta/revalida duas observações e exige compatible. RunRepository verifica revisão na transação e chama onInserted apenas na inserção nova. O manifesto é vinculado ao ID real por cópia dos campos capturados: não se consulta um Git novo para atribuí-lo ao prompt antigo. Input recebe context_manifest_id na mesma transação.

Worker usa a revisão/snapshot capturados, reautoriza root/owner/workspace depois de esperar e reconstrói na raiz aprovada. Compara identidade, fontes, configurações, Git/checkout, política e hashes. Registra started/receipt e bloqueia incompatibilidade antes do executor. Streams/logs/outputs/quotas/fences existentes permanecem.

Depois do trabalho, reobserva e registra finished. Drift retorna changed/unavailable/unverified independentemente do status técnico; sucesso e output são preservados. Se persistir a observação final falhar, não se inventa compatible: o DTO de execução terminal sem finished retorna unverified. Runs antigos sem referência continuam no contrato legado e nunca recebem fingerprint retroativo.

## 12. Integração com card_ai_runs

A request-key é consultada após autorização do card e validação da chave, antes de depender de modelo/defaults/projeto atuais. Repetição retorna o run/contexto original, inclusive se o modelo foi removido depois. Não recompõe fontes para reatribuir uma chave antiga.

O host fornece ProjectRegistry e PluginRegistry; ausência dessas dependências bloqueia novas capturas reais. As fontes são observadas antes do INSERT e revalidadas. is_internal_orbit e sentinelas orbit.workspace.json/orbit.shared-lock.json que afetam developmentGuidance são relidos, evitando política capturada parecer atual quando mudou.

Na transação, revisão e criação/retomada do run são verificadas, e o manifesto é salvo. FIFO/pausa/quota/workerId/eventos03A continuam. Dentro do lease/checkout, novo material e fontes são comparados antes de chamar provider. Identidade/ref/hash incompatíveis impedem execução sem fallback.

Uma nova execução rastreada inicia sessão nova quando o histórico anterior não tem compatibilidade comprovada; a decisão é registrada como session_selection, sem apagar a sessão anterior. Resposta usa seu próprio manifesto/revisão/worktree. Fontes comuns são comparadas; somente instrução/material/sessionBinding do novo turno são deltas autorizados. Pai permanece imutável e o filho é criado por CAS. Rejeição conhecida de retomada registra resume_rejected e mantém pergunta/output.

sessionBinding registra modo solicitado, hash da sessão e parent fingerprint; o receipt final registra hashes de sessão solicitada/resultante. Não é cópia ou validação integral da memória do CLI. Resposta legada sem manifesto verificável é recusada com diagnóstico, preservando histórico para preparação posterior, em vez de fingir compatibilidade.

## 13. Contexto e execução isolada

A03B continua responsável por identidade/clean source/base/ref/checkout aprovado e lifecycle de worktree. O contexto04 consome essa autoridade; não escolhe sozinho uma pasta autorizada. O clone de Project conserva authorizationRoot original e remapeia root/resourcesRoot para a worktree. As leituras selecionadas e seus hashes vêm do checkout aprovado.

O manifesto no enqueue registra a intenção/pin; o receipt de entrega registra a fase efetiva/owner. Isso não modifica retroativamente o manifesto para fingir que a worktree já existia na preparação. TesteT11 exercitou as duas filas com manager/coordinator/Git/worktrees reais de fixtures, SQL de app simulado e fontes/hashes verificados.

Sem isolamento solicitado, shared checkout continua protegido pela03A. HEAD observado não significa árvore limpa nem que todo arquivo esteja contido no commit: fontes são bytes selecionados do filesystem e hashes, com essa origem declarada. Not_applicable/unborn não fabrica SHA. Para isolamento, clean/base verificável continuam obrigatórios e não há fallback.

Locks físicos/PG, supervisão, ownership/quarentena e common-dir serializado permanecem. Coordinator, supervisor, rollback/file-scope e migrations157–159 não foram alterados nesta04. Nenhuma integração automática ou paralelismo irrestrito foi liberado.

## 14. Freshness e incompatibilidade

| Dimensão | Estados/significado |
| --- | --- |
| Demanda | pending/current/stale/unversioned da02, sem mudança de significado. |
| Contexto | captured: captura comprovada; unverified: falta de observação/prova; compatible: comparação selecionada aprovada tecnicamente naquele instante; changed: diferença relevante; unavailable: recurso obrigatório/escopo/integridade indisponível; legacy: sem manifesto. |
| Execução | Estados existentes das duas filas; um run success pode ter contexto changed. |
| Integração | Mantém not_integrated/ausência de aprovação; não é inferida de hash ou success. |

A comparação verifica integridade, unicidade/ordem das fontes selecionadas, escopos, disponibilidade, versões/hashes/proveniência e campos técnicos/configuração/material fornecidos pelo consumidor. Fontes extras não relacionadas não invalidam por si; alteração da seleção/configuração ou do texto entregue altera a observação pertinente.

Uma fonte apenas não reobservada fica unverified, sem ser falsamente declarada modificada/ausente. Required missing/unavailable fecha o início. Ausência opcional comprovada continua compatível somente enquanto permanece essa ausência. Dados históricos seguem referenciados no manifesto antigo, sem reaparecer como fonte atual.

Mudança durante execução preserva output e gera verificação separada. Igualdade de SHA não comprova regra de negócio, aprovação humana, resolução de conflito ou integração. Estado compatible contém observedAt e alcance; não é uma garantia permanente.

## 15. Plugins e desacoplamento

Não se criou outro PluginRegistry, fila, provider ou API de contribuição arbitrária. Registry/Core são autoridade; IA consome. Não há novo import Core→classe concreta do plugin IA. Contratos, actions, dependencies, schemas/RBAC e peculiaridades dos produtos permanecem.

Os metadados dos plugins relevantes incluem versões e compatibilidade com Core/API, capabilities e actions realmente disponíveis. Plugin desativado conserva identidade histórica e passa a unavailable para novo consumo obrigatório. Troca de contrato sem trocar nome é detectada pelo hash, não aprovada pelo próprio plugin.

Não foi criada contribuição dinâmica de corpo de contexto por plugin; o host compõe fontes autorizadas com os contratos existentes. Código de plugin arbitrário no processo não ganha sandbox por causa de ContextSource. Guardas03B de filesystem/Delivery/checks/efeitos remotos continuam aplicáveis.

Consumidor vetorial Suindá permanece inalterado e não é automaticamente fonte para todos os runtimes. Dados, DBs e permissões não foram compartilhados entre produtos. Produto novo recebe orbitContextRuntime próprio pelo gerador; identidade ambígua ou indevidamente mapeada como projeção comum bloqueia a geração.

## 16. Persistência e migrations

Nova160, aditiva, sem executar em produto:

| Objeto | Contrato |
| --- | --- |
| context_run_manifests | UUID, queue/run/turn,parent, card/revisão, project/workspace/actor/runtime, fingerprint/integrity_hash, manifesto JSONB e created_at; unique(queue,run,turn). |
| context_manifest_verifications | UUID, manifest FK, phase/status, observation JSONB e observed_at; append-only. |
| Binding trigger | Campos coluna devem corresponder ao body; filho usa mesma identidade/run e turn anterior+1. |
| Imutabilidade | UPDATE/DELETE/TRUNCATE bloqueados nas duas tabelas. Retenção administrativa exige política/mecanismo explícito futuro, não expiração automática. |

Não há FK cascade a partir de card/run/projeto, preservando evidência após exclusão administrativa. Isso não cria acesso automático a evidência órfã: o endpoint atual autoriza por run/card/projeto existentes; consulta administrativa de órfãos/retention ainda requer contrato próprio.

ContextManifestRepository.store usa lock transacional por fila/run e retorna captura original em retry compatível. Turno filho exige último parent; a constraint unique impede fork. Novas verificações não editam o manifesto. A transação pertence ao host, que une enqueue e vínculo.

SQL valida binding/forma básica/hash sintático; não recalcula SHA nem valida toda fonte interna. A biblioteca valida/recalcula, e a API verifica integridade antes de exportar DTO. Administrador SQL privilegiado não está contido por um hash de aplicação.

160 foi testada em PG16 descartável com identidade provada antes do DDL. Estado/aplicação de157–160 nos bancos reais continua não consultado. Não se inventam manifestos para runs antigos.

## 17. APIs e observabilidade

Endpoint Core somente leitura: `GET /execution/context/card_runs/:id` ou `/execution/context/card_ai_runs/:id`.

Autoriza ID/fila, card por features/cardBoard, projeto por owner, workspace atual e runtime/ator/binding do manifesto. Posse do UUID não concede acesso. Projeto indisponível/sem acesso recebe erro controlado; manifesto fora do escopo é negado. O endpoint não depende de executar IA, não é MCP e não dispara provider.

DTO: ID/turn/parent/schema, identidade de execução/revisão, base/ref quando disponível, fingerprint/integrity, hashes de material, fontes sem corpo/provenance privada, verifications e tempos. Não publica root físico, prompt/documento bruto, rawHash/provenance arbitrária ou checkoutOwner.

`last_verification_status` identifica evidência persistida; `context_status/live_verification` são observação atual somente de leitura, com reference authorized_project e horário. GET não grava verificações. Genérico pode reconstruir contexto atual completo no escopo; consulta de prompt usa observador parcial e não declara compatible para partes que não reobservou. Fontes de arquivo/card/plugin modificadas ainda podem ser sinalizadas; tipos não observados ficam unverified.

Em run terminal sem finished persistido, a evidência inicial não vira compatibilidade terminal. Consulta histórica permanece distinta do resultado da worktree e da origem atual. Isolamento suspenso/base não revalidável pode impedir comparação técnica atual, conservando a evidência anterior.

Não foi alterada UI nesta etapa: indicador completo fica para trabalho próprio, usando este contrato e preservando variantes. Não se afirma validação visual ou de browser.

## 18. Testes T1–T18

Comandos utilizados:

```sh
# A: unidade Core/registry/builders/runtime, descrita por arquivos em§19
TSX_DISABLE_CACHE=1 TSX_TSCONFIG_PATH=forge/app/apps/api/tsconfig.json CODEX_BIN=/nonexistent/orbit-fixture-never-codex node --import ./forge/app/node_modules/tsx/dist/loader.mjs --test forge/app/apps/api/src/execution/context-manifest.spec.ts forge/app/apps/api/src/execution/context-registry.spec.ts forge/app/apps/api/src/execution/context-runtime.spec.ts forge/app/apps/api/src/execution/execution.spec.ts forge/app/apps/api/src/card-contexts.spec.ts forge/app/apps/api/src/execution/isolated-execution-policy.spec.ts forge/app/apps/api/src/execution/file-scope.spec.ts forge/app/apps/api/src/execution/managed-process.spec.ts forge/app/apps/api/src/execution/project-checks.spec.ts forge/app/apps/api/src/execution/workspace-coordinator.spec.ts forge/app/apps/api/src/execution/workspace-process.spec.ts
# B: SQL e concorrência reais, cluster privado
node --test tools/orbit/context-manifests.postgres.test.mjs
# C: classes reais, DB/quota/provider fake, worktrees reais de fixtures
node --test --test-concurrency=1 tools/orbit/context-workers.test.mjs
```

| Cenário | Status | Método/evidência | Limitação |
| --- | --- | --- | --- |
| T1 | PASS | A: chaves canônicas, arrays ordenados, timestamps/runId semânticos excluídos, integrity vinculado. | Hash não é aprovação. |
| T2 | PASS | A/C: skill/arquivo selecionado modificado muda hash/fingerprint e bloqueia ou marca changed. | Granularidade selecionada, não semântica. |
| T3 | PASS | A/B: fonte removida não vira vigente; manifesto anterior imutável/referenciável. | Corpo histórico pode não estar arquivado. |
| T4 | PASS | A/B e regressão157: revisão nova não reescreve manifesto/revisão capturada; CAS mantido. | Não é versão integral do projeto. |
| T5 | PASS | A: card relacionado tem revisão/conteúdo reobservados; fonte compartilhada afeta dependentes. | Sem grafo semântico automático. |
| T6 | PASS | A: arquivo não selecionado alterado/malformado não muda seleção relevante. | Arquivo de configuração selecionado é unidade conservadora. |
| T7 | PASS | B/C: retry das duas filas retorna run/manifesto originais, inclusive após desativar config/remover modelo; CAS/unique reais em B. | RBAC continua obrigatório. |
| T8 | PASS | C: alteração durante espera impede executor/provider nas duas filas. A: corrida de preparação detectada. | Sem atomicidade FS+PG global. |
| T9 | PASS | C: drift durante execução preserva output/success e finished changed separado, duas filas. | SQL dos workers é simulado. |
| T10 | PASS | B/C: turno filho/parent, sessão compatível do próprio run retomada; contexto incompatível não apaga pergunta nem chama provider. | Não homologa memória ou CLI real. |
| T11 | PASS | C: ambos pipelines com IsolatedCheckoutManager/coordinator/worktrees Git reais de fixtures; hashes/config/pin na raiz aprovada e origem intacta. | SQL de app/provider simulados; Git é somente de fixture. |
| T12 | PASS | A/B e regressões: ausência de manifesto retorna legacy, sem fingerprint inventado. | Retomada legada não ganha compatibilidade automática. |
| T13 | PASS | A/C: contrato/escopo/disponibilidade, plugin desativado/contrato alterado bloqueia e identidade histórica permanece. | Sem contribuição dinâmica arbitrária. |
| T14 | PASS | A/B/C: runtime/projeto/workspace/ator divergentes negados; API real verifica recurso e omite dados privados; namespace de produto novo verificado no gerador. | Não substitui configuração operacional correta dos DBs. |
| T15 | PASS | C: enqueues/workers/Q&A/outputs/revision/coordenação das duas filas; regressões específicas de quota fake/eventos. | Não executa workers implantados. |
| T16 | PASS | Suítes01–03B repetidas nesta entrega, com fixtures corrigidas para interfaces evoluídas. | Não é npm test global. |
| T17 | PASS | A/B/C: duplicidade, JSON inválido, required ausente, race/escopo/ref/checkout inválidos fecham o fluxo. | Código externo não cooperante não é sandboxed. |
| T18 | PASS | Testes com HOME/binário/quota/PG próprios; guards SQL/probe; nenhum provider pago/embeddings/CLI real executado. | Não é auditoria de todo código herdado não executado. |

Todos os18 cenários foram executados dentro desses alcances. Não contar cada assert ou cenário T como um teste adicional aos números Node. Homologação operacional, Codex real e migrations de produto são NOT_RUN por restrição, não testes aprovados.

## 19. Testes de regressão

| Suíte efetivamente executada | Resultado final distinto |
| --- | ---: |
| A,71 testes: manifest23, registry11, runtime3 e34 testes existentes de execução/card-contexts/escopo/checks/coordinator/supervisor |71 PASS |
| Context PostgreSQL B |10 PASS |
| Classes reais C, incluindo T11 ambas worktrees |10 PASS |
| Prompt selecionados quatro runtimes: prompt queue/revision/disabled AI startup/Questionar/multi_agent |21 PASS (6 DEV,5 cada outro) |
| Tools shared/preflight/catalog/registry-foundation/card-revision-ui/card-version-enqueue/card-revisions.postgres/workspace-coordinator.postgres/workspace-workers |75 PASS |
|03B isolated-checkout, PG/Git descartáveis |16 PASS |
|03B isolated-provider com CLI fake |1 PASS |
|03B isolated-workers após adaptar ProjectRegistry da fixture |1 PASS |
| Gerador/codemods em fixtures, ambiente Git/HOME sanitizados |9 PASS |
| **Total sem contar reexecuções** |**214 PASS,0 FAIL finais,0 skipped** |

As quatro APIs passaram `node <runtime>/app/node_modules/typescript/bin/tsc --noEmit --incremental false -p <runtime>/app/apps/api/tsconfig.json` na versão final. Não houve mudança Web, nova compilação Web ou homologação visual. Preflight global continua BLOCK pelas condições anteriores; isso não foi contado como teste aprovado.

Comandos de regressão adicionais:

```sh
node --test tools/orbit/shared.test.mjs tools/orbit/preflight.test.mjs tools/orbit/catalog.test.mjs tools/orbit/registry-foundation.test.mjs tools/orbit/card-revision-ui.test.mjs tools/orbit/card-version-enqueue.test.mjs tools/orbit/card-revisions.postgres.test.mjs tools/orbit/workspace-coordinator.postgres.test.mjs tools/orbit/workspace-workers.test.mjs
node --test tools/orbit/isolated-checkout.test.mjs tools/orbit/isolated-provider.test.mjs
node --test tools/orbit/isolated-workers.test.mjs
TSX_DISABLE_CACHE=1 TSX_TSCONFIG_PATH=forge/app/apps/api/tsconfig.json CODEX_BIN=/nonexistent/orbit-fixture-never-codex node --import ./forge/app/node_modules/tsx/dist/loader.mjs --test --test-name-pattern='prompt queue|revision|disabled AI startup|Questionar|multi_agent' forge/app/apps/api/src/prompt-question.spec.ts
```

O comando de prompt é aplicado aos outros três prefixos/tsconfigs/loaders. Gerador foi executado com Node24 e env restrito: HOME mkdtemp, Git global/system desativados, hooksPath=/dev/null, fsmonitor=false, template vazio e CODEX_BIN inexistente. O teste de `database.mjs migrate` é negativo: URL sintética de nome incorreto causa exceção **antes de spawn/migration**, sem conexão DB.

Falhas intermediárias foram investigadas, não ocultadas:

- Scope do helper recebia identidade completa e deixava runId pending entrar no hash de plugin. Scope passou a projetar só quatro campos, com teste dedicado.
- ContextTechnicalState fazia Git128 em não-repositório sob supervisor, cujo125 reservado gerava quarentena. Ausência de .git/unborn agora são observadas antes do comando que falharia, sem afrouxar coordinator.
- Rebuild aprovado e Input antigo podiam divergir; Input/receipt/resources agora usam a mesma reconstrução.
- Verificação final não persistida poderia herdar compatible inicial; terminal sem finished fica unverified.
- Campos is_internal_orbit/sentinelas e namespace de produtos gerados precisavam observação própria.
- Retry dependia indevidamente de modelo/config atuais; ordem foi corrigida e testada.
- Ausência opcional gerava proveniência rawHash ausente versus null; representação foi normalizada e comparada.
- Um teste TypeScript construía literal com campo extra; passou a usar identidade tipada em variável, sem casts para esconder erro.
- Fixture03B antiga usava stub sem contextSource; recebeu ProjectRegistry real com autorização fake. Uma execução combinada reportou17/18 antes da correção; os16+1 anteriores passaram e o1 corrigido foi repetido com sucesso.
- Gerador já não gravava product.profile.json; teste dirigido encontrou e a gravação necessária foi restaurada.

Logs locais em `/tmp/orbit04-audit-gfc7jh_k/` ajudam revisão, mas os comandos/contratos deste documento permitem repetir a validação sem depender de retenção desses temporários. Não foi executada suíte herdada integral sem auditoria de efeitos.

## 20. Fontes canônicas e projeções

Core fonte final **1.7.7**,191 mappings, integridade `a38141620c2a7f833e3cb7c339e239f922152f9c839e0cd75e51f8094ef4ba38`. UI permanece1.1.3/74, integridade `8b8cc6ed2f02d2792da0787193cf0062801623c568e22f4804ee489c87ccdff8`. API Core1.0.0/Plugin API1 continuam contratos distintos da versão do pacote fonte.

Seis mappings novos: context-manifest.ts/spec, context-runtime.ts/spec, context-registry.spec e SQL160, em seus caminhos correspondentes apps/api. Seis fontes existentes de§8 receberam deltas comuns. Publicação oficial selecionou somente @orbit/core-source, com plano/precondições/atribuição de fontes; releases1.7.0 e patches1.7.1–1.7.7 registram a integração iterativa. Não houve edição manual de locks para maquiar drift.

Conferência final: **core drift0, locks pendentes0**. Permanecem as mesmas nove variantes UI; hashes das296 projeções UI e suas entradas de lock foram comparados ao preflight inicial, sem alteração. Nenhuma projeção UI foi escrita para liberar checker.

Nongeneric prompt-sessions/orbit-architecture/prompt-question receberam alterações localizadas nos quatro prefixos; diferenças de Safdoulas/Suindá, como assinatura/regras de múltiplos agentes/validação de body, foram preservadas. Não se substituiu arquivo inteiro por DEV.

Distribuir arquivos não é ativar, migrar, npm publish ou enviar Git remoto. Nenhuma branch por ambiente/repositório interno foi criado.

## 21. Segurança operacional

Não houve comandos de Docker, deploy, reinício, migration/seed/banco de produto, Codex real, modelos/embeddings pagos, Git mutável no Orbit, worktree ligada ao Git real, commit/push/tag ou limpeza operacional de recursos. Estado e eventual reação de hot reload de serviços existentes não foram usados como evidência de implantação.

PG16 foi initdb próprio, socket privado0700 e listen_addresses vazio. Teste B remove variáveis PG*/DATABASE_URL/CODEX/OpenAI, prova data_directory/usuário/versão/inet_server_addr antes do DDL, limita conexões ao socket da fixture e encerra só seu cluster. Um probe IPC local opcional do loader tsx foi bloqueado pela fixture e distinguido de conexão DB/outbound; não liberou acesso externo.

Filas reais nos testes têm quota/provider/DB simulados; claim/finish com quota real são substituídos onde necessário. CLI protocolar usa arquivo Node fake e HOME/codexHome próprio. Não foi repetido o incidente03A de possível quota/CLI real, nem apagado estado real de auth para tentar desfazer histórico.

A primeira fixture sem Git produziu um guard de quarentena do próprio teste. Foi removido somente o token exato após encerramento comprovado dos workers/subprocessos e identificação de raiz/UUID temporários; nenhum marcador operacional/desconhecido foi removido. A correção foi no observador, não em relaxar ownership/TTL/PID ou supervisor. Os testes finais de não-Git/unborn passaram sem quarentena.

Gerador só escreveu produtos em repositórios temporários; Git global/system/hooks foram bloqueados no ambiente de execução. O produto real não foi gerado/instanciado. Agentes trabalharam em arquivos delimitados; um agente documental atingiu limite de uso e o integrador assumiu o relatório. Não há medição que permita declarar economia de tempo/tokens.

## 22. Inventário Git

Branch/HEAD do início preservados; nenhuma operação de stage/commit/push/tag. Diff contra HEAD contém várias etapas e não é exclusivamente04.

**Novos04:** seis artefatos canônicos, suas24 projeções, dois testes tools e este relatório:33 arquivos. **Modificados04:** seis fontes comuns e24 projeções,12 arquivos nongeneric, quatro ferramentas/testes tools (incluindo gerador), AGENTS/experiência e seis metadados/locks:54 arquivos atribuídos. Diretórios não rastreados podem aparecer agregados no status.

No baseline1360,52 arquivos receberam deltas atribuídos e nenhum desapareceu. generate.mjs/test estavam limpos no início, fora daquele conjunto de dirty/shared hashes; seus dois deltas adicionais são exclusivamente04 e foram revisados contra HEAD. Os artefatos04 não existiam no baseline.

Preservados por hash fora do escopo atribuído: migrations157/158/159 e suas projeções; coordinator/process/supervisor; arquivo de scope/rollback; provider/adapter Codex existentes; relatórios01–03B e18–20/ZIP; main/card-dialog/libapi/prompt-execution; teacher-dashboard Suindá e UI. Arquivos de01/02/03A/03B que receberam delta adicional04 são identificados em§8, sem atribuir seu conteúdo inteiro à04.

O estado final/inventário de hashes foi registrado nos temporários de auditoria e confrontado com o diff. Código/documentação continuam como arquivos locais de trabalho, inclusive não rastreados; não se declarou envio ao remoto.

## 23. Limitações e riscos

- Compatible é uma comparação técnica de fontes selecionadas em um instante, não validade semântica, ausência de conflito ou aprovação/integridade global do projeto.
- FS e PG não são snapshot atômico; revalidação reduz corridas, não elimina alterações depois da última leitura. Autores externos não cooperantes continuam fora da coordenação absoluta.
- A04 não arquiva todos os corpos históricos nem a memória completa do CLI. Corpos removidos podem ficar indisponíveis, com hash/proveniência preservados. O boundary do hash entregue está declarado.
- Observação atual do prompt pela API é parcial: tipos dinâmicos não reobservados ficam unverified. Início/final do worker possuem coletor próprio completo para seu contrato. GET não persiste um novo check automaticamente.
- Escopo versão1 é um runtime/projeto/workspace/ator; grants entre produtos/workspaces não foram criados. Referências não representáveis falham fechadas.
- Granularidade é fonte/arquivo/configuração selecionada, não campo semanticamente inferido. Alterar arquivo de configuração selecionado pode invalidar conservadoramente, mesmo que a pessoa considere parte do conteúdo irrelevante.
- Shared checkout pode estar sujo; HEAD não é cópia completa da árvore.03B isolada continua exigindo base limpa/committed, sem copiar env/dependências/provisioning.
- Worktree/manifesto/ALS não são sandbox de rede/SO para plugin arbitrário, API remota ou ferramenta externa. Guardas03A/03B e suas limitações continuam.
- Manifesto/verificações são imutáveis no fluxo app/SQL previsto, não diante de superusuário que desabilite triggers/altere privilégios. SHA não é assinatura de autoria.
- Retenção, criptografia/backup e consulta administrativa de órfãos dependem de política explícita. Não publicar manifestos/artefatos brutos por conveniência.
- APIs históricas exigem acesso atual a run/card/projeto; exclusões podem tornar o endpoint normal indisponível embora o ledger sobreviva. Não se criou bypass administrativo.
- Sessão de outro run não é reutilizada apenas por IDs/SHA. Q&A é delta autorizado limitado; não prova que toda memória do modelo ficou reconciliada.
- Linux/UID/filesystems/Python/flock/sessão PG e empacotamento da03A/03B continuam precondições. Não foi homologado CLI/sandbox real ou workload implantado.
- Nenhuma homologação de todas as combinações/versões possíveis de plugins, browser, integrações remotas ou suíte herdada global foi alegada.

## 24. Pendências de ativação

1. Janela autorizada para inspecionar schemas reais e aplicar migrations na sequência necessária157→158→159→160. Nenhum banco foi consultado/aplicado nesta entrega.
2. Rollout de código compatível com160 antes de atender novos enqueues/consultas; não misturar workers antigos e anunciar rastreabilidade completa. Restart/deploy exigem autorização própria.
3. Manter ProjectRegistry/PluginRegistry reais injetados e orbitContextRuntime próprio por ambiente. Gerador já automatiza identidade/perfil; isso não configura/compartilha banco.
4. Para03B, storage privado, provisioning/efeitos externos, supervisor.py e sandbox real continuam pendentes de homologação/ativação; modo permanece opt-in, desligado por padrão.
5. Homologar API/filas/eventos/Q&A com workload sintético no runtime preparado, sem modelos pagos até autorização específica.
6. Definir retenção/privacidade/backups/recuperação e eventual consulta de evidências órfãs; imutabilidade não implica retenção infinita automática.
7. Desenvolver UI de contexto como trabalho separado, respeitando variantes. Gate global UI antigo continua pendência independente.
8. Não aplicar resultados à origem: Integration Gate e reconciliadores pertencem a etapas futuras.

## 25. Preparação para a próxima implementação

| Futuro componente | Ponto real disponível; ainda não implementado |
| --- | --- |
| Context Compiler completo | Fontes/seleção/configuration/assemblyPolicy/material hashes das duas montagens, ainda distintas. Falta compilação unificada com snapshot global e precedência completa. |
| Context Bridge/MCP | Identidades escopadas e API read-only podem servir de base; nenhum servidor/execução bidirecional foi criado. |
| RAG local/compartilhado | Hash/version/runtime/projeto/workspace permitem filtrar candidatos; não há novo índice, embeddings ou recuperação automática. |
| Knowledge Reconciliation | Histórico imutável e observações fornecem evidência; não resolvem contradições ou validam aprovação de regras. |
| Project Consistency Engine | Revisão/fingerprint/checks/checkout são insumos, sem análise semântica entre cards. |
| Integration Gate | Contexto capturado/verificado e resultados03B not_integrated permitem avaliar proposta futura; não há aprovação, merge ou aplicação. |
| Desired State Reconciler | Estados de intenção/contexto/execução/integração estão separados, sem laço de reconciliação automática. |

Não iniciar05 automaticamente; preservar os limites de autoridade e a diferença entre fato técnico, documentação e regra aprovada.

## 26. Handoff técnico

- Leia AGENTS, skill orbit-environment e relatórios01–04, incluindo ressalva03A e final03B. Faça Git/preflight somente leitura, preserve árvore não commitada e nove drifts UI.
- Fontes são packages/orbit-core; final1.7.7/191. Use publicação selecionada com plano/atribuição/precondições, nunca só projeção nem UI global. API Core1.0.0/Plugin API1 são versões distintas.
- Contratos: context-manifest.ts; host/git/plugins/DTO: context-runtime.ts; fontes: ProjectRegistry/ContextBuilder/card-contexts; consumo: execution.service/run-repository e quatro prompt-sessions.
- Repositório: store(client,manifest,{parentId?}), latest/get, observe/history. Host controla transação e RBAC; repository não autoriza sozinho um ID. Não atualize manifestos para evitar reconciliação.
- Sempre observe campos relevantes: compareContextManifest com apenas sources não comprova configuration/git/checkout/material omitidos. As filas fornecem o conjunto completo; observador parcial deve declarar o alcance.
- Bind runId sem recapturar Git/versões. Scope de fonte tem somente runtime/projeto/workspace/ator; não deixe identidade operacional pendente entrar no fingerprint.
- Construa o input entregue depois de rebuild/verify. Se final verification falhar, preserve output e mostre unverified, não reaproveite compatible inicial como estado terminal.
- Q&A usa pai/filho do mesmo run e valida dependências comuns; delta explícito é só instrução/material/sessionBinding. Rejeição não apaga pergunta; nova execução não herda outra sessão por conveniência.
- Worktree vem do manager03B; mantenha authorizationRoot original e root/resourcesRoot aprovados. Nenhum prompt escolhe pasta ou ambiente. Generated product já recebe namespace próprio e product.profile.json; não copie identidade DEV manualmente.
- API: GET execution/context/card_runs|card_ai_runs/:id, autorizada e read-only. Usar DTO, não JSON bruto. last_verification_status e live_verification são dimensões temporais diferentes.
- Comandos seguros§18–19. PG exige16 nativo, nunca DATABASE_URL de produto; T1..T18 usam fixtures/quota/provider/HOME próprios. Não executar npm test global sem revisar efeitos de CLI/cotas/auth/DB.
- Legacy fixtures desabilitam tracing apenas por monkeypatch de teste para exercitar contrato antigo; não existe flag pública de prompt que dispense registries. Suite04 não usa esse atalho.
- Se fixture falhar, espere workers/filhos e finalize só seu PG. Cleanup deve provar token/run/root próprios. Nunca limpar quarantine por TTL/PID ou varrer marcadores operacionais.
- Schemas/serviços/CLI real continuam não homologados. A autorização de código/teste não permite migration/restart/deploy. Empacotamento de supervisor, storage e política de dados continuam necessários.

## 27. Resultado final

**CONCLUÍDA no escopo de código, testes isolados e distribuição em arquivos da Implementação04.**

| Dimensão | Estado |
| --- | --- |
| Registry/manifestos/fingerprints/turnos/observações | IMPLEMENTADOS E VERIFICADOS no escopo descrito. |
| Duas filas, sessões e API autorizada | IMPLEMENTADAS E VERIFICADAS com classes reais/fixtures; sem terceira fila. |
| Testes distintos finais |214 aprovados,0 falhos finais,0 ignorados. T1–T18 PASS no alcance descrito. |
| Compilação |Quatro APIs PASS na versão final; Web não alterada. |
| Fontes/projeções |Core1.7.7/191 nos quatro runtimes; drift core0, locks0; UI1.1.3/74 e nove variantes preservadas. |
| Banco/ativação/implantação |NÃO REALIZADOS nos produtos; schemas reais não consultados. |
| Homologação operacional/CLI real |NOT_RUN por restrição; pendências explícitas§24. |
| Memória semântica/MCP/RAG novo/integração automática |NÃO IMPLEMENTADOS e fora do escopo. |

Não há rascunho pendente de integração apresentado como entrega final. Os limites de prova estão explícitos, especialmente observação parcial do prompt no GET, não atomicidade FS/DB, retenção/histórico e contenção de escritores externos. A05 não foi iniciada.
