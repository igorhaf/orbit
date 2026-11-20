# gastro-oceanica

Gerado da base Orbit DEV no commit 48b332820ff271d8c407b2072c6a505af0462a75. Interface, permissões e lógica vêm da base existente.

Execute os comandos abaixo na raiz deste produto.

1. Revise product.profile.json, copie .env.example para .env e configure os segredos próprios. JWT_SECRET precisa de pelo menos 32 caracteres. Em banco novo, configure ORBIT_BOOTSTRAP_ROOT_NAME, ORBIT_BOOTSTRAP_ROOT_EMAIL e ORBIT_BOOTSTRAP_ROOT_PASSWORD (mínimo 12 caracteres; máximo 72 bytes UTF-8). Contas ROOT existentes são preservadas.
2. Provisione o banco PostgreSQL isolado orbit_gastro_oceanica; nenhum banco foi criado pelo gerador.
3. Instale dependências com npm --prefix app ci.
4. Execute npm run db:prepare para aplicar migrations e seed somente no banco declarado no perfil.
5. Execute npm run profile:plan e npm run profile:apply para configurar os plugins.
6. Revise o resultado e inicie explicitamente com npm run dev. Web: 3011; API: 4011.

Os comandos db:migrate e db:seed também podem ser usados separadamente. O runner carrega .env e encaminha ORBIT_NATIVE_ROOT para a aplicação; o exemplo já aponta para app deste produto.

## Simulação de perfis ROOT

A simulação preserva a sessão e o ator de auditoria ROOT e apresenta contexto fictício para todos os papéis do catálogo, incluindo papéis de plugins. Mantenha personas e fixtures isoladas por produto. Rotas ainda ligadas aos dados normais devem falhar fechadas; o modo permanece somente leitura até que as escritas estejam restritas às fixtures. Siga `docs/profile-simulation.md` ao acrescentar fluxos de domínio.

O gerador não inicia serviços. Não copie .env, dados ou credenciais de outros produtos. Plugins filhos devem declarar parentPlugin e dependencies; regras específicas deste produto ficam em plugins próprios. As capacidades não selecionadas continuam no código reutilizável e são desativadas pelo perfil no banco isolado.

## Produto

Gastro Oceânica reutiliza o shell, workspaces, permissões, auditoria e motor de registros versionados do Orbit. O plugin `gastro-clinic` oferece cadastros administrativos sintéticos de pessoas atendidas e profissionais, além de agendamentos com integridade das referências no mesmo workspace, estado e validação temporal. A interface genérica de registros Orbit apresenta esses tipos de domínio.

Prontuários, evolução clínica, prescrição, procedimentos, financeiro e regras legais não estão habilitados: a documentação consultada ainda não fornece regras validadas suficientes para implementá-los com segurança. Não utilize dados reais de saúde. A geração/edição/execução de código por IA é bloqueada no backend; recursos de IA assistiva dependem das permissões do ambiente.
