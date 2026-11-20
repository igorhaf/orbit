# Experiência de produto Orbit

Este documento define como criar experiências próprias para Safdoulas, Suindá e produtos futuros sem romper o modelo arquitetônico e os padrões de interação do Orbit.

## Regra central

Cada produto deve parecer uma experiência Orbit contextualizada pelo seu domínio. Compartilhe a arquitetura e os padrões de uso do Orbit; expresse a identidade do produto pela hierarquia das tarefas, linguagem, composição das páginas, marca, tokens visuais e fluxos de domínio.

Padronização não significa copiar literalmente a mesma tela para todo produto. Identidade própria também não significa criar uma aplicação paralela com navegação, componentes, permissões ou regras duplicadas.

## O que vem do Orbit

- O shell autenticado, os pontos globais de navegação e os controles persistentes devem reutilizar os componentes comuns do Orbit.
- Workspaces continuam definindo o escopo organizacional dos dados; RBAC e permissões de recurso continuam sendo a fonte de autorização.
- Use os contratos de plugins, o registry, registros e revisões, quadros e cartões, documentos, auditoria, notificações e demais capacidades existentes quando forem adequados ao domínio.
- Use os padrões Orbit de pesquisa, filtros, listas, formulários, estados vazios, confirmações, foco, teclado, responsividade e feedback de ações.
- Mantenha plug-ins de produto desacoplados, declarando dependências e contribuições reais. O domínio do produto pode ter componentes próprios; não deve clonar serviços ou capacidades comuns do core.

## O que dá identidade ao produto

- Organize as páginas pelo trabalho que cada perfil precisa realizar e pela sequência real do domínio.
- Use nomes, exemplos, estados, indicadores, ícones, imagens, acentos de cor e conteúdo pertencentes ao produto. Quando aplicável, use os tokens e recursos de branding configuráveis do Orbit.
- Dê destaque visual aos objetos e decisões centrais daquele domínio. A identidade deve aparecer nas telas de trabalho, não apenas no login ou em uma página pública.
- Preserve a leitura, contraste, acessibilidade, responsividade e previsibilidade dos componentes Orbit. Não invente um segundo sistema visual sem necessidade funcional.
- Páginas públicas podem ter composição de marca própria quando a audiência e a finalidade forem distintas; autenticação, sessão, API, permissões e dados continuam integrados ao Orbit.

## Navegação e fluxos

- A navegação primária apresenta áreas e tarefas reconhecíveis para as pessoas usuárias, não o mapa interno de plugins, migrations ou tipos de registro.
- Plugins contribuem links para uma hierarquia coerente. A mesma ação deve ter um ponto principal de entrada; use links contextuais para retomar o trabalho, sem criar hubs concorrentes.
- O que aparece deve ser determinado pelas permissões efetivas e pelo papel/contexto da conta. Ocultar um link não substitui a autorização no servidor.
- Quando várias operações compõem um único processo de domínio, ofereça uma jornada centrada no processo: estado atual, pendências, responsável, prazo e próxima ação. Preserve formulários e vistas especializadas onde sejam úteis, mas evite exigir que a pessoa conheça a decomposição técnica para completar a tarefa.
- Não misture painéis de públicos diferentes numa página longa sem hierarquia ou seleção clara. A entrada deve priorizar a próxima tarefa relevante para a pessoa e fornecer caminhos deliberados às demais áreas autorizadas.
- O catálogo, onboarding ou portal de um produto pode usar recursos próprios do domínio, mantendo shell, navegação, acessibilidade e componentes de interação Orbit compatíveis.

## Simulação de perfis ROOT

A simulação de perfil deve permitir validar o trabalho real que cada papel encontra em cada produto, não apenas remover permissões da conta ROOT. Ao selecionar um papel, preserve a sessão e a identidade de auditoria do ROOT e associe a requisição a uma persona de demonstração própria daquele runtime. A interface deve indicar claramente o produto, o perfil e o contexto de demonstração ativos.

- Gere ou mantenha contexto para todo perfil global presente no catálogo de acesso do banco daquele runtime; não codifique uma lista incompleta de papéis. Papéis criados depois também precisam receber contexto.
- Cada persona e seus registros ficam isolados no banco, workspace e produto correspondentes. Não reutilize usuários, matrículas, processos, quadros ou dados pessoais reais como fixtures.
- A persona recebe as permissões do papel selecionado e registros de exemplo coerentes com as áreas e tarefas que esse papel pode consultar. Uma rota só pode ler ou alterar dados se estiver ligada a fixtures isoladas; qualquer rota ainda ligada ao banco normal deve falhar fechada durante a simulação. Enquanto não houver escrita isolada implementada, o contexto é somente leitura. Não provoque integrações externas, notificações reais, envios, deploys ou alterações de configuração do runtime.
- Retornar a ROOT restaura permissões e dados próprios da conta sem trocar token, sessão ou identidade. Requisições paralelas e abas diferentes precisam manter seus contextos independentes.
- A criação dos exemplos deve ser idempotente, identificável e reversível; usuários/personas de demonstração não podem autenticar, aparecer como contas reais no diretório, nem conceder acesso a dados fora do contexto.
- O contrato comum pertence ao core Orbit. Cada produto pode contribuir fixtures de domínio, por meio de plugins, sem mudar a semântica de simulação nem duplicar regras de autorização.

### Requisito para produtos novos

O gerador de produtos deve carregar este contrato desde o início. Cada projeto novo precisa manter contexto genérico para todos os papéis e exigir que plugins específicos contribuam exemplos de domínio para seus papéis e tarefas. A cobertura de simulação por papel faz parte da revisão de produto; não é uma etapa opcional posterior. As instruções do produto gerado devem documentar o isolamento, o comportamento somente leitura e o fail-closed para rotas ainda não ligadas a fixtures.

## Forge como ponto de integração

O monorepo contém seis runtimes de aplicação independentes: `forge/app`, `workspace/app`, `safdoulas/app`, `suinda/app`, `rumo/app` e `gastro-oceanica/app`. Eles compartilham a branch Git `main`, mas ainda têm cópias que podem divergir; bancos, arquivos, configuração, dados e serviços permanecem isolados por ambiente/produto.

O Forge (identidade persistida `dev`) é o ponto de interseção para desenvolver e validar compatibilidade das capacidades comuns. Mudanças de core ou plugins comuns precisam ser reconciliadas no Forge, onde se conferem contratos, dependências, permissões, eventos, versões, referências de core, schemas e comportamento conjunto. Depois, determine e atualize os runtimes aplicáveis, preservando customizações e diferenças de produto intencionais. Não trate a cópia do Forge como publicação automática para Workspace, Safdoulas, Suindá, Rumo ou Gastro Oceânica; a compatibilidade é verificada e integrada, e a implantação permanece um passo separado e autorizado.

Antes de encerrar uma mudança que toque contratos ou capacidades comuns:

1. Identifique se a fonte canônica está em `packages/`; quando estiver, altere a fonte e sincronize apenas os runtimes aplicáveis pelo fluxo documentado.
2. Verifique compatibilidade e interação com os plugins que podem coexistir, não apenas com o plugin que motivou a mudança.
3. Confirme quais runtimes precisam receber a mudança comum e quais diferenças específicas devem ser mantidas.
4. Mantenha configuração, bancos, arquivos e dados isolados; não use dados de um produto para validar outro.
5. Registre o que foi validado no Forge e em cada runtime, sem inferir publicação ou validação visual que não ocorreu.

## Revisão de uma experiência

Antes de concluir uma tela ou fluxo novo, confirme:

- O fluxo começa e termina dentro do shell e da navegação esperados do Orbit?
- A pessoa encontra a tarefa pelo conceito do domínio, sem precisar saber qual plugin implementa cada etapa?
- A home ou página de entrada prioriza o contexto e a próxima ação do perfil ativo?
- Existe uma superfície principal para cada fluxo, sem duplicação de hubs ou caminhos contraditórios?
- A identidade do produto está visível nas áreas autenticadas e combina com o conteúdo e as ações daquele domínio?
- Workspaces, permissões e políticas de dados são respeitados tanto na interface quanto no servidor?
- A solução reutiliza capacidades Orbit onde apropriado e mantém extensões de domínio desacopladas?
- O resultado funciona em desktop e mobile, por teclado e com feedback acessível?
- Se há contratos comuns envolvidos, a compatibilidade foi reconciliada no Forge e nos runtimes aplicáveis?

As respostas devem orientar decisões concretas de implementação; este documento não autoriza mudanças fora do escopo, serviços, commits ou deploy.

## Instruções também usadas pelo painel Codex

Este contrato orienta agentes em sessões diretas e o painel Codex incorporado ao Orbit. O painel inicia e retoma sessões com `orbitArchitecturePrompt`, enviado como `developerInstructions`, e atualiza esse contexto antes de cada novo turno; as execuções dos cartões também incluem esse contrato em seu contexto. Portanto, qualquer nova regra persistente sobre arquitetura Orbit, experiência por produto, compatibilidade ou fluxo de desenvolvimento deve ser sincronizada em `AGENTS.md`, nas skills aplicáveis e em `apps/api/src/orbit-architecture.ts` nos seis runtimes. O prompt incorporado reforça a leitura deste documento, o papel integrador do Forge e o isolamento de cada runtime. Atualize primeiro Forge, confira os contratos e então mantenha os runtimes aplicáveis alinhados. Não finalize uma instrução persistente apenas na documentação enquanto o contexto injetado nas ferramentas de IA permanecer diferente.

## Atualidade de resultados de cartões

Revisões de demanda pertencem ao core e funcionam com IA desativada. cards.card_revision é monotônica e gerida pelo banco; não a escreva manualmente nem invente revisão histórica para runs legados. Ao criar execução, capture a revisão do mesmo snapshot de título/descrição usado no input e valide-a transacionalmente. Preserve resultados antigos e distinga status de execução de freshness (pending/current/stale/unversioned). Para substituir a descrição usando um resultado, use expected_card_revision e trate conflito 409. A revisão base não versiona checklists, anexos, comentários, configuração independente, fontes ou contexto do projeto; não a apresente como fingerprint completo ou garantia de isolamento concorrente. A interface mantém o resultado disponível, indica a revisão capturada e a atual e impede substituir automaticamente a descrição por um resultado antigo ou sem revisão comprovada. Mover o cartão, marcar conclusão ou atualizar progresso não deve criar uma nova revisão da demanda base.

## Espera e proteção do workspace

Escritas das filas card_runs e card_ai_runs usam o coordenador físico do Orbit Core durante preparação mutável, executor, verificações e drenagem. Não substitua essa proteção por status do job, projectId, TTL ou locks exclusivos do plugin IA. Execute subprocessos pelo supervisor do core e valide a área protegida; perda de conexão, identidade física incerta ou autoria de rollback não comprovada exigem interrupção e podem colocar o workspace em quarentena. Não apague marcadores de ownership nem restaure arquivos automaticamente para liberar uma fila. A proteção cobre os caminhos integrados, não editores humanos, APIs Git independentes ou ferramentas externas; não a apresente como isolamento por worktree. A experiência deve distinguir espera pelo workspace, execução ativa, conflito/quarentena, cancelamento e interrupção; esses diagnósticos não alteram a semântica de freshness da revisão base.

## Resultados em checkouts isolados

Worktrees por execução são opt-in do host e pertencem ao Core, com run/card/revisão/projeto/workspace e commit-base verificáveis. Solicitar isolamento nunca autoriza fallback para o checkout original, cópia de árvore suja, commit, integração ou descarte automático. Preserve resultados e evidências fora da árvore de origem; sucesso do executor não aprova integração. Mantenha common-dir serializado até haver prova isolada de separação segura, não retome sessão de outra worktree e bloqueie actions/checks externos sem autoridade homologada. Worktree não é sandbox universal nem versão integral do contexto. Consulte docs/implementacao-arquitetural/03B-WORKTREES-ISOLADAS-POR-EXECUCAO.md. A experiência deve distinguir execução, resultado preservado, espera por resposta, reconciliação, quarentena e integração ainda não realizada.

## Contexto versionado por execução

Manifestos de contexto pertencem ao Core e registram fontes selecionadas, escopo, versões, hashes e material entregue por run/turno. Diferencie intenção vigente, estado observado e contexto entregue; demanda, contexto, execução e integração têm estados independentes. Não reescreva manifestos para fazê-los parecer atuais, não fabrique histórico para runs legados e não reutilize sessão quando fontes relevantes ou autorização forem incompatíveis. Revalide fontes antes de executar e registre mudanças posteriores separadamente, preservando outputs. Hash não concede acesso nem aprovação semântica; consulta de contexto exige autorização por recurso e não publica prompts, segredos ou caminhos físicos. Consulte docs/implementacao-arquitetural/04-PROJECT-CONTEXT-REGISTRY-E-MANIFESTO-VERSIONADO.md.

Cada runtime deve declarar orbitContextRuntime próprio; produtos gerados recebem seu identificador automaticamente e não devem herdar o namespace dev. Essa identidade é configuração do host, nunca texto escolhido pelo agente ou pelo prompt.

## Compilação e orçamento de contexto

O Context Compiler é determinístico e opt-in do host. Separe seleção autorizada, compilação e entrega; preserve as políticas de confiança e registre inclusões, omissões, deduplicações, orçamento e hashes. Material obrigatório que não couber bloqueia a execução, sem fallback silencioso ao legado. Estimativas locais de tokens não são consumo faturável nem controlam memória interna, ferramentas ou imagens do provider. Documentos e resultados continuam sendo dados com proveniência; não viram instruções privilegiadas. Manifestos antigos permanecem imutáveis, runs legados conservam seu modo e mudanças de política/material compartilhado impedem retomada silenciosa. Consulte docs/implementacao-arquitetural/05-CONTEXT-COMPILER-E-ORCAMENTO-DE-CONTEXTO.md.

## Consultas dinâmicas de contexto

O Context Bridge é uma consulta read-only vinculada pelo host ao runtime/projeto/workspace/ator/card/revisão/run/turno e ao manifesto compilado. Reautorize cada consulta, limite volume e concorrência, registre proveniência sem corpos ou credenciais e revogue o vínculo em término, pergunta pendente, cancelamento ou perda de ownership. IDs e fingerprints não autenticam. Não promova dados documentais a instruções, não altere manifestos para incluir leituras novas e não use o Bridge para escrita, Git ou integrações. O protocolo local orbit-context-bridge/1 foi criado para adapter restrito; não é MCP homologado com Codex. Preserve MCP vazio e sandbox/rede do modo isolado, sem fallback para permissões maiores. Consulte docs/implementacao-arquitetural/06-CONTEXT-BRIDGE-BIDIRECIONAL.md.

## Recuperação lexical de projeto

A recuperação lexical de projeto pertence ao Core e reutiliza o BM25 compartilhado. Use somente candidatos explicitamente autorizados pelo host, reautorize e revalide fontes por consulta; cache não concede acesso. Diferencie candidato, selecionado e efetivamente entregue pelo compilador. Capture política, corpus, consulta, versões e ranking no manifesto sem reescrever runs históricos. Conhecimento recuperado permanece dado documental opcional, nunca host_policy ou aprovação semântica. Preserve o opt-in do host e o isolamento runtime/projeto/workspace/ator; não habilite MCP, embeddings ou buscas globais como fallback. Consulte docs/implementacao-arquitetural/07A-RAG-LEXICAL-COMPARTILHADO-E-CONHECIMENTO-VERSIONADO.md.

## Consulta lexical dinâmica

A busca lexical dinâmica knowledge.search é opcional e exclusiva do binding autorizado: exige Compiler, recuperação07A, Bridge e opt-in host capturados. Pesquise somente os candidatos e versões evidenciados na preparação; revalide integralmente corpus, ACL, card, turno e checkout. Não amplie manifest.sources nem material histórico para incluir leituras posteriores. Compartilhe orçamento, timeout, concorrência, revogação e auditoria do Bridge; registre hashes e metadados limitados, nunca consultas ou corpos brutos. Anuncie orbit_knowledge_search somente quando o host conceder a capability. Bindings antigos continuam com cinco ferramentas. Consultas Core em worktree exigem manager03B ativo e verificação física de pin/ownership; isso não homologa MCP/UDS no sandbox nativo. Preserve os guards Codex e ausência de embeddings. Consulte docs/implementacao-arquitetural/07B-CONSULTA-LEXICAL-DINAMICA-CONTEXT-BRIDGE.md.

## Descobertas propostas por execuções

O Discovery Journal pertence ao Core e registra apenas propostas estruturadas, limitadas e vinculadas pelo host a runtime/projeto/workspace/ator/card/revisão/run/turno/manifesto. Capture sob lease e checkout autorizados; preserve outputs e status técnico quando a captura falhar. Propostas permanecem proposed/review_required, sem aprovação, injeção em outros cards ou indexação automática na recuperação07A/07B. Ingestão de texto livre exige política explícita por projeto e revisão de privacidade do envelope completo pelo host; hashes e citações não comprovam verdade, aprovação ou disponibilidade atual. Reautorize leituras, diferencie evidência histórica e observação atual, mantenha idempotência e histórico append-only. Não use o Bridge/MCP para escrever no Journal nem desbloqueie Codex nativo. Consulte docs/implementacao-arquitetural/07C-DISCOVERY-JOURNAL-MEMORIA-PROPOSTA-VERSIONADA.md.

## Capacidades de IA por produto

Geração, edição e execução de código por IA ficam restritas a Forge e Workspace e são verificadas no backend. Safdoulas, Suindá, Rumo e Gastro Oceânica usam IA apenas em tarefas assistivas sem geração, alteração ou execução de código. Plugins e permissões precisam preservar a mesma barreira; bloqueios de interface são insuficientes. A simulação ROOT continua read-only, e contribuições de plugins podem fornecer exemplos sintéticos limitados sem conceder autorização.

Rumo organiza o trabalho com quadros, listas e cartões como objetos centrais, usando os componentes compartilhados de Orbit. Gastro Oceânica compõe cadastros e agenda administrativos com identidade clínica própria. Dados de saúde são sintéticos durante desenvolvimento; prontuários, prescrições, condutas e obrigações legais dependem de regras validadas antes de implementação.

## Base para novos produtos

Produtos novos devem partir do Workspace (`prod`) por padrão e selecionar somente os plugins e capacidades necessários ao domínio. Forge (`dev`) permanece como ponto de integração para reconciliar e validar compatibilidade entre ambientes. Um produto derivado mantém banco, dados, configuração e serviços próprios, além da identidade de runtime que o gerador atribui.
