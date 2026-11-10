# Quadros modulares e Coleções

A capacidade genérica `process-board` depende de `versioned-records` e `structured-view`.
Um plugin de domínio declara `contributions.processBoards` com nome, endereço interno e privilégio de entrada.
O catálogo de Quadros e o menu lateral mostram essas contribuições autorizadas; o componente reutilizável `ProcessBoard` renderiza grupos, fases e links para os registros originais.
O domínio mantém sua própria validação e autorização da API, sem copiar registros para cartões universais.

Coleções é o plugin `collections`, independente de IA e dos quadros de processos.
Os privilégios são `plugin.collections.read` e `plugin.collections.write`, além do acesso normal ao quadro.
A política de quadros bloqueia o acesso direto, inclusive root, quando o plugin está desligado.
A view `authorized_board_members` aplica a mesma restrição às leituras compartilhadas, como pesquisa, calendário e home.
A desativação preserva os dados e o seed não recria categorias enquanto o plugin estiver desativado.
Os componentes atualizam a disponibilidade por eventos autenticados de plugins.

No SafDoulas, há uma contribuição única **Acreditação de cursos** em `/safdoulas/processes`, com um grupo por curso e nove fases.
Diligências, recursos e acompanhamento são indicados como etapas quando aplicáveis; o quadro não altera decisões ou inventa conclusão de etapas.
Coleções fica desativada somente nessa instância; a migration genérica preserva o estado anterior em DEV e PROD.

Validação sem navegador: lint/TypeScript e testes unitários de `collections.spec.ts`; integração com banco descartável para conferir visibilidade, negativas por RBAC, suspensão e preservação de dados.
O caso SafDoulas acrescenta testes de agrupamento único e a jornada documental existente.
Selenium e outros navegadores continuam desautorizados neste host.

## Criação de projetos e quadros

O plugin `project-boards` está desativado no SafDoulas; a migration 135 registra a escolha do produto sem afetar DEV/PROD. `scripts/safdoulas-project-creation-verify.mjs` verifica estado persistido, bloqueio das cinco URLs de criação para ROOT, consulta preservada e contagens de projetos/quadros inalteradas. Requer DATABASE_URL e JWT_SECRET no ambiente, sem expor credenciais. As verificações unitárias de isolamento estão em `plugins/project-boards/project-boards.spec.ts`.

## Navegação dos plugins

Os 13 links do SafDoulas são declarados pelos plugins em um grupo Acreditação, com quatro seções: Acompanhamento, Cadastros e normas, Tramitação, Publicação e privacidade. O core só renderiza metadados genéricos.

`node --import tsx scripts/safdoulas-navigation-verify.mjs` valida o catálogo real da API, a ordem, os 13 destinos, o filtro de RBAC e a ausência de grupos vazios, com DATABASE_URL e JWT_SECRET no ambiente; nenhuma configuração ou registro é alterado. Os testes de composição estão em `apps/web/lib/plugin-navigation.spec.ts`. A validação de navegador permanece pendente por restrição do host.
