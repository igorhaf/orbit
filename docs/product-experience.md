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

## DEV como ponto de integração

O monorepo contém quatro runtimes de aplicação independentes: `dev/app`, `prod/app`, `safdoulas/app` e `suinda/app`. Eles compartilham a branch Git `main`, mas ainda têm cópias que podem divergir; bancos, arquivos, configuração, dados e serviços permanecem isolados por ambiente/produto.

O Orbit DEV é o ponto de interseção para desenvolver e validar compatibilidade das capacidades comuns. Mudanças de core ou plugins comuns precisam ser reconciliadas em DEV, onde se conferem contratos, dependências, permissões, eventos, versões, referências de core, schemas e comportamento conjunto. Depois, determine e atualize os runtimes aplicáveis, preservando customizações e diferenças de produto intencionais. Não trate a cópia de DEV como publicação automática para PROD, Safdoulas ou Suindá; a compatibilidade é verificada e integrada, e a implantação permanece um passo separado e autorizado.

Antes de encerrar uma mudança que toque contratos ou capacidades comuns:

1. Identifique se a fonte canônica está em `packages/`; quando estiver, altere a fonte e sincronize apenas os runtimes aplicáveis pelo fluxo documentado.
2. Verifique compatibilidade e interação com os plugins que podem coexistir, não apenas com o plugin que motivou a mudança.
3. Confirme quais runtimes precisam receber a mudança comum e quais diferenças específicas devem ser mantidas.
4. Mantenha configuração, bancos, arquivos e dados isolados; não use dados de um produto para validar outro.
5. Registre o que foi validado em DEV e em cada runtime, sem inferir publicação ou validação visual que não ocorreu.

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
- Se há contratos comuns envolvidos, a compatibilidade foi reconciliada em DEV e nos runtimes aplicáveis?

As respostas devem orientar decisões concretas de implementação; este documento não autoriza mudanças fora do escopo, serviços, commits ou deploy.

## Instruções também usadas pelo painel Codex

Este contrato orienta agentes em sessões diretas e o painel Codex incorporado ao Orbit. O painel inicia e retoma sessões com `orbitArchitecturePrompt`, enviado como `developerInstructions`, e atualiza esse contexto antes de cada novo turno; as execuções dos cartões também incluem esse contrato em seu contexto. Portanto, qualquer nova regra persistente sobre arquitetura Orbit, experiência por produto, compatibilidade ou fluxo de desenvolvimento deve ser sincronizada em `AGENTS.md`, nas skills aplicáveis e em `apps/api/src/orbit-architecture.ts` nos quatro runtimes. O prompt incorporado reforça a leitura deste documento, o papel integrador do DEV e o isolamento de cada runtime. Atualize primeiro DEV, confira os contratos e então mantenha os runtimes aplicáveis alinhados. Não finalize uma instrução persistente apenas na documentação enquanto o contexto injetado nas ferramentas de IA permanecer diferente.
