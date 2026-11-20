# Gestão de processos e Coleções como plugins

`process-board` oferece o componente de grupos e fases em Gestão estruturada e depende de `structured-view` e `versioned-records`.
Um adaptador declara `contributions.processBoards` com `id`, `name`, `href` interno e `permission`; os identificadores não podem se repetir no plugin.
O host inclui as contribuições autorizadas no catálogo de Quadros e no menu lateral.
A API de cada adaptador exige os privilégios `views.structured.use` e `plugin.process-board.read`, além da autorização de cada registro e da disponibilidade efetiva das dependências.
Os grupos e fases são projeções dos dados originais; o domínio mantém suas transições e seus formulários sem criar cópias de registros em cartões.
O componente `ProcessBoard` recebe grupos e carrega as fases por demanda, com pesquisa, filtro de fase, expansão e links para os registros.

`collections` controla a organização de cartões reutilizáveis, sem depender de IA.
Os privilégios são `plugin.collections.read` e `plugin.collections.write`, combinados com os privilégios e o compartilhamento dos quadros.
Ao desativar o plugin, os dados continuam armazenados, o seed deixa de criar categorias, os atalhos desaparecem e o acesso direto aos quadros de Coleções fica bloqueado inclusive para root.
A política de quadros e a view `authorized_board_members` aplicam os bloqueios também às consultas compartilhadas, como pesquisa e calendário.
A migration 132 preserva a ativação e os privilégios equivalentes dos ambientes existentes; um cliente pode desativar o plugin nas próprias configurações.
A disponibilidade do cliente é atualizada por eventos autenticados de plugins, com preservação das preferências de navegação.

Valide sem navegador: testes `collections.spec.ts`, integração de registros em banco descartável e builds de API/web.

## Criação de projetos e quadros

O plugin independente `project-boards` controla o menu Criar, os atalhos da página inicial, da lista de quadros e dos workspaces, o formulário de cadastro de projetos e a cópia de quadros. A interface verifica o estado efetivo do plugin e os privilégios `boards.write` e `projects.write`, sem depender da IA. O modal de criação pertence ao plugin e é carregado sob demanda.

A API bloqueia POST /boards, POST /boards/:id/copy, POST /ai/projects e POST /ai/projects/directories quando o plugin está desativado, inclusive para ROOT. Consulta e edição de recursos existentes e criação de registros de domínio permanecem independentes. Desativar não remove dados. A configuração é persistida em plugin_settings; uma reativação restaura os controles em tempo real.
