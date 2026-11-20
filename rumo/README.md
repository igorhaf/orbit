# rumo

Gerado da base Orbit DEV no commit 48b332820ff271d8c407b2072c6a505af0462a75. Interface, permissões e lógica vêm da base existente.

Execute os comandos abaixo na raiz deste produto.

1. Revise product.profile.json, copie .env.example para .env e configure os segredos próprios. JWT_SECRET precisa de pelo menos 32 caracteres. Em banco novo, configure ORBIT_BOOTSTRAP_ROOT_NAME, ORBIT_BOOTSTRAP_ROOT_EMAIL e ORBIT_BOOTSTRAP_ROOT_PASSWORD (mínimo 12 caracteres; máximo 72 bytes UTF-8). Contas ROOT existentes são preservadas.
2. Provisione o banco PostgreSQL isolado orbit_rumo; nenhum banco foi criado pelo gerador.
3. Instale dependências com npm --prefix app ci.
4. Execute npm run db:prepare para aplicar migrations e seed somente no banco declarado no perfil.
5. Execute npm run profile:plan e npm run profile:apply para configurar os plugins.
6. Revise o resultado e inicie explicitamente com npm run dev. Web: 3010; API: 4010.

Os comandos db:migrate e db:seed também podem ser usados separadamente. O runner carrega .env e encaminha ORBIT_NATIVE_ROOT para a aplicação; o exemplo já aponta para app deste produto.

## Simulação de perfis ROOT

A simulação preserva a sessão e o ator de auditoria ROOT e apresenta contexto fictício para todos os papéis do catálogo, incluindo papéis de plugins. Mantenha personas e fixtures isoladas por produto. Rotas ainda ligadas aos dados normais devem falhar fechadas; o modo permanece somente leitura até que as escritas estejam restritas às fixtures. Siga `docs/profile-simulation.md` ao acrescentar fluxos de domínio.

Perfis com `boards.read` também recebem exemplos sintéticos de planejamento, quadro e tarefa, contribuídos pelo plugin Orbit `project-boards`. Esses exemplos são apresentados somente como contexto de simulação; não correspondem a registros persistidos e não habilitam operações.

O gerador não inicia serviços. Não copie .env, dados ou credenciais de outros produtos. Plugins filhos devem declarar parentPlugin e dependencies; regras específicas deste produto ficam em plugins próprios. As capacidades não selecionadas continuam no código reutilizável e são desativadas pelo perfil no banco isolado.

## Produto

Rumo compõe os quadros, listas e cartões do Orbit para gestão visual de projetos. A base inclui quadros de projeto, cartões com checklists, responsáveis, etiquetas, prazos, comentários, anexos e histórico, com busca e filtros do ambiente Orbit. A identidade visual usa tokens próprios e mantém o shell e componentes compartilhados. A geração/edição/execução de código por IA é bloqueada no backend; recursos de IA assistiva permanecem sujeitos às permissões do ambiente.
