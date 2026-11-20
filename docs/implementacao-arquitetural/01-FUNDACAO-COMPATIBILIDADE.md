# Implementação 01 — Fundação de compatibilidade

Data: 2026-11-13. Resultado: **PARCIALMENTE CONCLUÍDA**.

## 1. Resumo executivo

Foi implementado um preflight arquitetural reutilizável no CLI existente, com saída JSON/texto, classificação determinística e operação somente de leitura. Reaproveita `inspectShared`, `buildCatalog`, `diagnosePlugins` e o parser estático de imports. Não cria outro gerenciador de plugins. Acrescenta evidência de hashes ao inspector existente e permite consultar o catálogo sem ler/gravar seu cache.

A fundação foi testada com fixtures temporárias e com o `PluginRegistry` real DEV usando definições sintéticas. A suíte final relacionada passou: 30 testes. Também passaram os 7 testes existentes do `file-scope` canônico em diretórios temporários. Não houve acesso a banco, bootstrap da aplicação, execução Codex, API de embeddings, Docker, instalação, reinício, deploy, commit ou alteração operacional de produtos.

As derivas identificadas nos relatórios 19/20 permanecem. São 17 projeções divergentes entre 984 examinadas: oito de core e nove de UI. Não houve sincronização. O mecanismo oficial de reconciliação é global e seu dry-run rejeita as diferenças independentes de UI, inclusive uma variante intencional do Safdoulas. Não foi contornada essa proteção para publicar um core parcialmente reconciliado. O verificador geral também acusa uma condição de tema/layout do Suindá, fora desta etapa.

O caminho de verificação e os testes estão entregues. A reconciliação das fontes e a aprovação para promover mudanças comuns continuam bloqueadas. Não se declara a fundação inteiramente sincronizada nem se inicia o Card Version Manager.

## 2. Estado inicial do repositório

- Raiz: `/home/meada/projetos/orbit`.
- Branch: `main`.
- HEAD: `d9307b8e6a54316f802acbd7bcb96baa26116f16`.
- Nenhuma alteração rastreada no início.
- Arquivos preexistentes não rastreados, preservados: `docs/sondagem-arquitetural/18-VALIDACAO-OPERACIONAL-E-FECHAMENTO.md`, `19-FECHAMENTO-DE-CONCORRENCIA-MCP-E-VERSOES.md`, `20-AUDITORIA-PLUGINS-IA-DESACOPLAMENTO.md` no mesmo diretório, e `docs/sondagem-arquitetural2.zip`.
- `orbit.workspace.json` registra DEV, PROD, Safdoulas e Suindá, com aplicações e portas isoladas. Pacotes canônicos: `packages/orbit-core` e `packages/orbit-ui`; a versão core fonte continua `1.3.0`. Versão do pacote fonte não é a versão da API de plugins.
- O mapa compartilhado contém 246 arquivos por runtime. A contagem histórica de 245 na documentação não foi usada como garantia; o inspector leu o manifesto atual.

As diferenças de core/UI já estavam no HEAD, embora a árvore rastreada estivesse limpa. Árvore Git limpa não prova correspondência entre fonte canônica e projeção.

## 3. Documentação considerada

Foram lidos os relatórios 00–20, incluindo uma frente auxiliar somente de leitura para 00–17. As conclusões foram cruzadas com ferramentas e arquivos atuais; não foram tratadas como autorização para executar serviços ou assumir testes históricos como testes desta entrega.

| Relatório | Uso nesta implementação |
|---|---|
| 00 | Panorama dos plugins e das duas trilhas de execução; evitar promessa de compatibilidade operacional. |
| 01 | Monorepo parcial e isolamento dos quatro runtimes; propriedade limitada ao mapa compartilhado. |
| 02 | Inventário e verificadores existentes; reaproveitar ferramentas. |
| 03 | Preservar filas, executores e fluxo atual. |
| 04 | Migrations centralizadas e ausência de revisão geral de cards; não alterar schema. |
| 05 | Multiagent nativo Codex não é supervisor Orbit; não criar infraestrutura de agentes. |
| 06 | Decisões de filas, custo e contratos permanecem abertas. |
| 07 | Documentação e execução podem divergir; preservar variantes de produto. |
| 08 | Distinguir decisão de arquitetura de conclusão comprovável no código. |
| 09 | Índice de contratos, testes e pontos existentes para navegação. |
| 10 | Falta vínculo imutável card/run/contexto/HEAD; não alegar solução nesta etapa. |
| 11 | Edição, exclusão e concorrência permanecem riscos. |
| 12 | JSONL e pergunta ao usuário não constituem Context Bridge. |
| 13 | Lexical local é reutilizável sem API; vetores e autorização têm limites próprios. |
| 14 | Locks/checks atuais são proteções parciais, não consistência global. |
| 15 | Identidade de execução e obsolescência exigem política posterior. |
| 16 | Reutilizar registry, builders, verificações e evidências. |
| 17 | Assimetria das filas e rollback cruzado; somente testes isolados nesta etapa. |
| 18 | Reprodução histórica de perda cruzada por snapshot; proteção de escopo não é isolamento. |
| 19 | Priorizar diagnóstico de deriva/versionamento e preservar diferenças independentes. |
| 20 | IA é base parcial; imports internos e Nest global não aparecem no grafo declarativo. O assistente Suindá é consumidor concreto de recuperação vetorial, nuance posterior aos relatórios anteriores. |

Também foram consultados `AGENTS.md`, a skill `orbit-environment`, `docs/acceleration/README.md`, manifesto, metadados de pacotes, locks, checker de compatibilidade, contratos/registry e consumidores de IA. A demanda é trabalho local direto, sem contexto de cartão ou `write_scope` fornecido.

## 4. Arquitetura encontrada

`tools/orbit/cli.mjs` carrega o workspace e descobre perfis de produtos gerados. `shared.mjs` possui `packageSnapshot`, `inspectShared`, `reconcileShared`, persistência com precondições/rollback e comandos de bump/sync. O inspector calcula hashes e detecta deriva, regressão, remoção de propriedade e conteúdo alterado sem incremento. `reconcileShared` atribui alterações à execução e protege escopo/destinos, mas planeja uma publicação global dos pacotes/runtimes; não oferece seleção independente de pacote.

`catalog.mjs` usa AST TypeScript local para obter definições sem executar módulos. Resolve factories/registrations dentro de limites estáticos, valida dependências declaradas e compatibilidade core e compara contratos entre runtimes. O catálogo convencional grava cache em `.orbit/cache/catalog`; o novo caminho o desativa completamente. O parser TypeScript e Ajv vêm das dependências já instaladas; nenhum pacote é baixado.

`PluginRegistry` continua sendo a autoridade real de registro, capabilities, schemas, dependências e enablement de actions. O preflight não o substitui nem instancia plugins da aplicação. Os providers/controladores Nest continuam estáticos. Imports de `CodexAiService`, PromptSessions e retrieval são dependências de compilação separadas das listas `dependencies`.

Filas, workers, core, AI provider, ContextBuilder, ProjectRegistry, Git, permissões, migrations e bancos não foram modificados. O CONTROL também não foi alterado.

## 5. Decisões técnicas

1. **Compor em vez de duplicar:** preflight usa o inspector e catálogo existentes. A informação por projeção foi adicionada ao inspector para evitar um segundo cálculo/interpretação de hashes.
2. **Cache desligado explicitamente:** capturar exceção de escrita do catálogo não assegura somente leitura; por isso `cache:false` evita inclusive consultar esse cache.
3. **Metadados dinâmicos permanecem pendentes:** o catálogo agora registra caminhos não resolvidos em `unresolvedContracts`. O preflight não compila schemas simplificados desses plugins como se fossem completos.
4. **Classificação conservadora:** contrato diferente entre produtos gera aviso; conflito com propriedade compartilhada declarada bloqueia sobrescrita. Isso não declara que a customização seja defeito.
5. **Nenhum reparo automático:** o core tem dois arquivos candidatos à publicação patch, mas a reconciliação oficial global acusa UI independente. Não copiar manualmente, manipular locks ou inventar hashes para tornar o checker verde.
6. **Sem nova regra obrigatória para executores:** o comando é uma capacidade opt-in documentada. Não foi alterado o contrato persistente de arquitetura/experiência nem `orbitArchitecturePrompt`; portanto não houve sincronização desses contratos nos runtimes.
7. **Testar registry sintético:** importar apenas registry/contratos locais, sem AppModule/DB/provider, demonstra proteções com IA desligada sem desabilitar plugins reais.
8. **Delegação mínima:** uma frente leu histórico/revisou diferenças e depois revisou o código. Nenhuma escrita concorrente. A escolha buscou reduzir leituras repetidas; não foi medida economia percentual de tempo/tokens.

## 6. Implementações realizadas

| Arquivo relativo completo | Responsabilidade anterior | Alteração e justificativa | Resultado, consumidores e limites |
|---|---|---|---|
| `tools/orbit/shared.mjs` | Hashes, diagnóstico e projeção de pacotes | `inspectShared` passa a devolver `projectionStates`, usando os hashes já calculados. | Campo aditivo com runtime/pacote/fonte/destino/canônico/actual/locked. Sync e reconcile mantêm comportamento anterior; só o preflight consome o novo campo. |
| `tools/orbit/catalog.mjs` | Descoberta AST, diagnóstico, cache e impacto | Opção adicional `{cache:false}` em `catalogRuntime`/`buildCatalog`; `unresolvedContracts`; export `runtimeImports`. | Catálogo/impact existentes mantêm cache padrão. Preflight usa análise sem persistência. Imports são arestas estáticas resolvidas, não descoberta completa de DI ou imports dinâmicos. |
| `tools/orbit/cli.mjs` | Dispatcher JSON de ferramentas | Registra `preflight`, documenta help e renderiza texto apenas nesse comando quando solicitado. | Comandos antigos mantêm JSON. Sem flags de escrita novas. Produtos descobertos seguem o mesmo fluxo do CLI. |
| `tools/orbit/preflight.mjs` | Não existia | Compõe inspector, catálogo sem cache, schemas Ajv, imports e Git somente leitura. | JSON estruturado/texto; não executa os checks recomendados. Cobertura de estado operacional permanece explícita como não verificada. |
| `tools/orbit/preflight.test.mjs` | Não existia | Sete testes em fixtures temporárias para classificação, hashes/locks, dependências, schemas, metadados dinâmicos e preservação de arquivos. | Árvore da fixture, incluindo `.git`, conteúdo e mtimes, é comparada antes/depois de duas chamadas; ausência de cache também é coberta. Git mutante existe apenas na fixture com ambiente Git sanitizado. |
| `tools/orbit/registry-foundation.test.mjs` | Não existia | Um teste do registry DEV com plugins sintéticos em processo tsx, sem bootstrap. | IA sintética desligada bloqueia dependente e preserva validação de permissão/schema do plugin independente; cobre dependência ausente, ciclo e core incompatível. Loader já instalado é obrigatório. |
| `docs/acceleration/README.md` | Catálogo de comandos e métodos | Documenta invocação, saída, classificações, limites e link deste handoff. | Documentação de ferramenta, sem mudar políticas de execução dos produtos. |
| `docs/implementacao-arquitetural/01-FUNDACAO-COMPATIBILIDADE.md` | Não existia | Relatório oficial desta entrega. | Evidência e handoff; não autoriza etapa 02. |

Nenhum arquivo de runtime ou pacote canônico foi editado nesta etapa. As mudanças em ferramentas têm compatibilidade aditiva com suas funções anteriores.

## 7. Contratos e interfaces

Comandos seguros:

```sh
node tools/orbit/cli.mjs preflight --runtime dev --format text
node tools/orbit/cli.mjs preflight --format json
```

`--runtime` é opcional (padrão: todos os runtimes descobertos); `--format` aceita apenas `json` ou `text` (padrão JSON). Flags desconhecidas e `--write` são rejeitadas. Não há opção que execute sincronização, testes ou serviços.

JSON `schemaVersion:1`:

- `operation`, `readOnly:true`, `written:false`, `target`, `status`, `ok`, `promotionReady:false`.
- `git`: HEAD, branch, registros brutos porcelain v1 NUL de alterações, sem abrir conteúdo dos arquivos listados. Git roda com variáveis `GIT_*` herdadas removidas, configuração global desativada e `GIT_OPTIONAL_LOCKS=0`.
- `summary`: contagens de findings por classificação, não número de defeitos únicos.
- `findings`: `status`, `code`, runtime/plugin/path/campos/evidência conforme o caso.
- `projections`: hashes SHA-256 de fonte, projeção e lock; status, classificação e `automaticUpdate:false`.
- `runtimes`: metadados estáticos do catálogo, não prova de disponibilidade/enablement real.
- `imports`: arestas diretas resolvidas de consumidores externos ao diretório IA para arquivos de `plugins/ai/`. Não são todas as dependências de todos os plugins; dependências declarativas permanecem no catálogo.
- `requiredChecks`: comandos recomendados com descrição do isolamento. Não são resultados executados.

| Status | Critério |
|---|---|
| PASS | Condição estática satisfeita no inspector/catálogo. Não equivale a homologação de runtime. |
| WARN | Árvore alterada, imports diretos, diferença de contrato entre produtos ou aviso do catálogo. Preservar e revisar. |
| BLOCK | Fonte/projeção/lock incompatível, risco de sobrescrita, dependência ausente/circular, core incompatível, schema/capability inválido ou impossibilidade de inspecionar fontes compartilhadas. |
| NOT_VERIFIED | Git/parser/validator indisponível, campo AST dinâmico, catálogo incompleto ou estado operacional não consultado. |

Agregação: BLOCK > NOT_VERIFIED > WARN > PASS. `ok` e exit code 0 apenas para PASS/WARN; BLOCK/NOT_VERIFIED retornam exit code 1. Mesmo com arquivos sincronizados, os findings operacionais não verificados permanecem; o comando não é um gate de deploy. Erros de invocação/configuração são erros JSON do CLI com exit code 1.

APIs aditivas: `inspectShared(...).projectionStates`; `catalogRuntime(root,runtime,existingScan,{cache:false})`; `buildCatalog(root,config,runtimeId,{cache:false})`; `runtimeImports(root,runtime)`; `preflight(context,runtimeId)`; `formatText(result)`. Nenhum contrato de `PluginRegistry` ou action foi substituído.

## 8. Fontes e projeções

Situação anterior e posterior são iguais: todas as diferenças abaixo foram preservadas.

| Caminhos | Evidência/classificação | Ação nesta etapa e solução posterior |
|---|---|---|
| `packages/orbit-core/src/execution/file-scope.ts` e `.spec.ts`; projeções em `{dev,prod,safdoulas,suinda}/app/apps/api/src/execution/` | Canônico adiciona exclusões operacionais `.orbit`, dados de runtime e `.next*`, com três testes adicionais. Quatro runtimes idênticos entre si, correspondendo aos locks antigos. Infraestrutura genérica desatualizada, oito projeções. | Testados os 7 casos canônicos. Não publicado: dry-run oficial bloqueia UI. Após reconciliação de propriedade/UI, publicar patch por ferramenta oficial; não confundir exclusões com isolamento concorrente. |
| `@orbit/core-source` em `packages/orbit-core/package.json`, workspace e quatro locks | Versão `1.3.0` sem incremento para conteúdo novo; `version-not-bumped` nos quatro runtimes. | Não incrementada isoladamente para disfarçar publicação incompleta. Reconcile planeja patch, mas recusa persistência global devido à UI. |
| `packages/orbit-ui/src/components/plugin-navigation.tsx` e quatro projeções | Projeções idênticas entre si, diferentes do canônico/lock. Runtimes corrigem dropdown de fixed para absolute com alinhamento relativo. Correção genérica não promovida. | Preservadas. Sincronizar canônico antigo reintroduziria desalinhamento. Promover correção após testes visuais/consumidores. |
| `packages/orbit-ui/src/components/codex-limits.tsx` e quatro projeções | Canônico/lock antigos esperam prop `visible`; runtimes têm barra compacta e DEV difere dos demais na responsividade. Contrato e comportamento precisam de revisão. | Preservados. Definir base comum e adapters após revisar consumidores; não escolher uma variante por suposição. |
| `packages/orbit-ui/src/components/access-shell.tsx` e projeção Safdoulas | Safdoulas contém branding “SAFDOULAS · ACREDITAÇÃO”, sidebar e dados de boards. Diferença intencional de produto; demais correspondem ao canônico/lock. | Preservada. Resolver propriedade declarada versus adaptação de produto usando contribuição/adapter; não atualizar lock fingindo equivalência. |
| `{dev,prod,safdoulas,suinda}/app/orbit.shared-lock.json` | Quatro locks desatualizados perante o snapshot canônico novo. | Preservados; só devem mudar junto de release íntegra pelo mecanismo oficial. |

`reconcileShared` com `allowWrite:false` e os dois caminhos core em `changedFiles` retornou `ok:false`, `written:false`, `blocked:diagnostics`, com nove `local-drift` de `@orbit/ui-source`. Esse resultado comprova por que não houve liberação segura usando o fluxo oficial atual. A alternativa de adicionar seleção transacional de pacote requer extensão/testes próprios e não foi improvisada nesta entrega.

## 9. Testes executados

Ambiente: host local, Node e dependências TypeScript/tsx/Ajv já instaladas; nenhum serviço foi iniciado. Diretórios sintéticos ficam sob o temporário do sistema e são removidos. As ações Git `init/add/commit` dos novos testes pertencem exclusivamente a repositórios temporários, nunca ao monorepo.

| Comando/verificação | Resultado e alcance |
|---|---|
| `node --test --test-concurrency=1 tools/orbit/preflight.test.mjs tools/orbit/catalog.test.mjs tools/orbit/shared.test.mjs tools/orbit/registry-foundation.test.mjs` | **30/30 passaram** na execução final, sem skips. Inclui 9 catálogo, 13 shared, 7 preflight e 1 registry. Rodadas intermediárias de 28 e 29 também passaram; casos foram acrescentados após revisão. |
| `TSX_DISABLE_CACHE=1 node --import ./forge/app/node_modules/tsx/dist/loader.mjs --test packages/orbit-core/src/execution/file-scope.spec.ts` | **7/7 passaram**, somente arquivos sintéticos. Não demonstra ausência de rollback cruzado. |
| `node tools/orbit/cli.mjs preflight --runtime dev --format text` | Saiu com **BLOCK**, exit 1, pelos drifts preexistentes; formato humano conferido. |
| `preflight(context)` para os quatro runtimes | **BLOCK**; 984 projeções, 17 divergentes, 29 arestas diretas de imports IA. Catálogos: DEV 40 plugins/62 actions; PROD 42/62; Safdoulas 55/62; Suindá 58/63. Contagens são metadados estáticos, não plugins ativos em banco. A execução final agregou 4 PASS, 5 WARN, 46 NOT_VERIFIED e 34 BLOCK; os findings podem referir-se ao mesmo drift sob aspectos diferentes. |
| `reconcileShared(context,{changedFiles:[...dois file-scope...],allowWrite:false})` | Falha esperada de planejamento: nove drifts independentes de UI; nada persistido. |
| `node scripts/verify-plugin-compatibility.mjs` | **Falhou, exit 1**. Acusou core sem bump, nove drifts UI, 17 projeções, quatro locks e condição do layout/tema Suindá. Não foi ajustado para produzir verde. |

O checker Suindá exige um padrão textual com `forcedTheme` em `suinda/app/apps/web/app/layout.tsx`. Sua falha confirma que o padrão esperado não está presente; não comprova por si só falha visual em runtime. Nenhuma correção temática foi feita fora do escopo.

Não foram executados testes com DB, browser, integração externa, aplicação real ou Codex real/fake. A revisão final de sintaxe dos quatro módulos MJS alterados/novos passou (`node --check`), assim como `git diff --check`; a conferência Git não mostrou alterações em runtimes/pacotes/CONTROL. Não foi executada suíte completa de aplicação nem builds: não houve alteração em sua implementação e os gates compartilhados permanecem bloqueados. A verificação dos novos testes inclui conteúdo e mtimes da árvore temporária, inclusive `.git`, para demonstrar ausência de persistência no preflight.

## 10. Segurança e compatibilidade

O preflight só lê manifesto, fontes, locks e metadados Git. Não lê `.env`, credenciais ou banco. O parser interpreta AST limitada, não carrega módulos da aplicação; fixtures incluem `throw`/actions que falhariam se executadas. Ajv compila apenas schemas estaticamente resolvidos usando dependência local. Nenhum processo Codex/provider é instanciado pelo comando.

O único subprocesso do preflight é Git somente leitura. Recomendações de teste são strings, não executadas. Cache do catálogo é desativado. O teste do registry valida uma definição independente com IA sintética desabilitada, sem mudar `plugin_settings` ou permissões reais.

Nenhum arquivo de DEV/PROD/Safdoulas/Suindá, CONTROL, bancos, configurações, locks ou pacotes canônicos foi escrito. Contratos de runtime não mudaram; apenas ferramentas locais foram estendidas. Assim não houve necessidade de sincronização indiscriminada de produtos ou operação em produção.

## 11. Diferenças Git

Preexistentes e preservados: relatórios 18, 19, 20 e arquivo ZIP citados na seção 2. Nenhum deles pertence ao diff funcional desta entrega.

Alterados nesta implementação: `tools/orbit/catalog.mjs`, `tools/orbit/cli.mjs`, `tools/orbit/shared.mjs`, `docs/acceleration/README.md`.

Criados: `tools/orbit/preflight.mjs`, `tools/orbit/preflight.test.mjs`, `tools/orbit/registry-foundation.test.mjs` e este relatório. O resumo do diff é uma extensão aditiva das ferramentas, testes e documentação. Não há remoções de funcionalidades de aplicação ou mudança de schema.

Nenhum commit, stage, branch nova, reset, restore, clean, stash, push ou deploy do monorepo foi executado. Arquivos novos aparecem não rastreados e os quatro arquivos existentes aparecem modificados para revisão.

## 12. Limitações

- Análise estática não comprova bootstrap Nest, permissões de rotas reais, instalação/enablement em banco, assinatura de métodos internos ou integração de todos os plugins.
- Dependências continuam IDs, sem ranges de versão por consumidor. Imports dinâmicos/DI e resolução fora dos caminhos locais não são um grafo completo.
- AST possui limites. Campos não resolvidos são marcados e sua compilação de schemas é evitada; código que constrói metadados por execução complexa exige outro teste de contrato isolado.
- `schema-validator-unavailable` e ausência de parser são NOT_VERIFIED, não download automático. Alguns testes dependem de `forge/app/node_modules` já preparado.
- O preflight não classifica automaticamente intenção de diferenças runtime-owned. O catálogo compara contratos; a revisão humana deste relatório identificou as variantes UI conhecidas.
- Prova de somente leitura é de conteúdo/mtime em fixtures e inspeção do código, não medição de todos os syscalls no host.
- A publicação core não foi concluída. A fundação de compatibilidade não está liberada para distribuição comum aos quatro produtos.

## 13. Pendências técnicas

| Prioridade | Pendência | Condição de fechamento |
|---|---|---|
| Bloqueante para promoção comum | Core fonte sem bump e projeções antigas | Reconciliar release pelo mecanismo oficial, com atribuição de caminhos, versões e locks corretos. |
| Bloqueante para sync global | Nove diferenças UI independentes, incluindo variante intencional Safdoulas | Revisar ownership/adapters e consumidores; preservar produto e promover correções comuns com testes. |
| Importante | Checker legado acusa condição de tema Suindá | Comparar exigência textual com contrato atual e testar UI antes de corrigir checker ou produto. |
| Importante | Metadados parcialmente dinâmicos/limite do catálogo | Usar NOT_VERIFIED e criar testes de contrato específicos quando essas definições forem alteradas. |
| Importante para etapas concorrentes | Locks/filas e isolamento real | Harness PostgreSQL descartável e coordenação comum em etapa própria; nenhuma garantia nova nesta entrega. |
| Não bloqueante para ferramenta | Imports internos IA permanecem | Evoluir portas/contratos públicos posteriormente; não reescrever consumidores nesta fundação. |
| Não bloqueante para especificação | Política de obsolescência e sessão | Definir campos revisionados e tratamento de resultados antigos na revisão da etapa 02. |

## 14. Riscos conhecidos preservados

1. **Execução obsoleta após edição de card:** snapshot de input não tem revisão imutável validada ao concluir. Nada foi corrigido aqui.
2. **Concorrência entre as duas filas:** `card_runs` e `card_ai_runs` possuem locks e reivindicação assimétricos; preflight não é coordenador.
3. **Snapshot/rollback cruzado:** risco reproduzido historicamente; exclusões operacionais do core não atribuem autoria às escritas nem isolam executores.
4. **Contexto Codex não versionado:** hash de recurso não equivale a fingerprint persistido/válido para retomada de sessão.
5. **Ausência de Context Bridge estruturado:** prompt/JSONL/progresso não oferecem RPC autenticado de contexto e ferramentas.
6. **Drift fonte/projeções:** oito projeções core e nove UI continuam divergentes. O preflight detecta e preserva, sem resolver por cópia.
7. **Dependências implícitas IA:** registry não representa todos os imports internos; o teste sintético não homologa os consumidores reais.

## 15. Preparação para a etapa 02

A preparação entregue é verificável: há um comando somente de leitura, hashes por fonte/projeção/lock, contratos/capabilities catalogados, metadados dinâmicos identificados e testes independentes para o registry com IA desabilitada. São úteis para delimitar e revisar a mudança de versionamento de cards.

Os pontos existentes permanecem: `forge/app/apps/api/src/main.ts` (`Service.updateCard`), `execution/run-repository.ts` (enqueue/finish), `plugins/ai/prompt-sessions.ts` (criação/conclusão/retomada), `execution/context-builder.ts`, `execution/project-registry.ts` e UI de resultados em `apps/web/components/card-dialog.tsx`. Suas projeções mapeadas devem partir das fontes em `packages/orbit-core`, observando o manifesto; nem todos os arquivos AI são compartilhados.

Antes de implementar: revisar este relatório externamente; resolver a publicação compartilhada ou definir um plano de pacote transacional formalmente testado; decidir política de revisão/freshness; preparar DB efêmero comprovado. Testes da etapa 02 precisarão cobrir edição antes/depois de enqueue/claim, conclusão antiga, ambas filas, idempotência/CAS, sessão/contexto e compatibilidade com IA desabilitada. Esses testes e componentes não foram implementados nesta etapa.

## 16. Conclusão de entrega

**PARCIALMENTE CONCLUÍDA.** A implementação A e os testes relacionados da implementação C estão entregues. A implementação B foi investigada e classificada; permanece bloqueada para publicação segura pelo fluxo global existente. Os critérios de preservação, ferramentas reproduzíveis, testes isolados, contratos, custo e ausência de operação em produção foram atendidos. A sincronização efetiva das fontes/projeções e uma base inteiramente compatível não podem ser declaradas concluídas.

A ferramenta retornar BLOCK é o comportamento esperado diante do snapshot atual, e não um teste omitido ou um motivo para diminuir o critério. Há evidência suficiente para revisar/especificar o versionamento, mas a autorização externa e os bloqueios acima precedem sua implementação compartilhada. A etapa 02 não foi iniciada.

## 17. Orientações para o próximo implementador

1. Comece por `git status --short --branch` e HEAD. Preserve os quatro arquivos preexistentes não rastreados e as alterações desta entrega; não faça reset/stash/sync automático.
2. Leia este relatório e 18–20. Use `preflight --runtime dev --format text` para inspeção rápida e JSON para caminhos/hashes completos. Execute sem redirecionar saída para dentro do projeto se quiser preservar a garantia operacional de não escrita.
3. Rode os testes da seção 9. O registry fixture não exige DB; o loader deve estar instalado. Não substitua isso por `npm test` de aplicação sem verificar que suas suítes não usam DATABASE_URL real.
4. Para release, examine `shared.mjs`: `reconcileShared(...allowWrite:false)` é plano; não chame persistência enquanto houver UI independente. Não altere os hashes de lock para aceitar conteúdo sem release.
5. A fonte core file-scope e spec são os únicos drifts core encontrados. Há exclusões úteis, mas o risco de concorrência continua. Não os apresente como fix de isolamento.
6. Reveja UI por responsabilidade: dropdown corrigido em todos; limits com contratos/variantes; access-shell Safdoulas de produto. Escolha adapters/contributions em alteração própria, evitando perda de identidade ou permissões.
7. `projectionStates` e `unresolvedContracts` são aditivos; mantenha o modo de preflight sem cache. O CLI antigo continua com cache padrão. Não acrescente execução de checks no preflight somente de leitura.
8. Nenhuma nova instrução arquitetural persistente foi imposta. Se a próxima etapa mudar regras de arquitetura/fluxo, siga AGENTS e sincronize documentação/skills e `orbitArchitecturePrompt` nos quatro runtimes dentro do escopo autorizado.
9. Não inicie Card Version Manager, MCP, coordinator ou migração com base em status PASS de uma subchecagem; `promotionReady` é falso e as pendências de promoção permanecem.
