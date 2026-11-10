# Credenciais nos cadernos do cofre

Cada caderno possui campos de **nome**, **constante opcional** e **valor**, acima das anotações. É possível adicionar e remover campos. O nome identifica a credencial; a constante aceita letras, números e sublinhado, começando por letra ou sublinhado. Sem constante, a credencial permanece pessoal e não entra no catálogo de integrações.

Os valores ficam ocultos na interface e são criptografados junto das anotações com a proteção já usada pelo cofre. Revelar o valor permite editar também textos com várias linhas, como chaves privadas. O autosave preserva campos e anotações. Copiar o caderno para um card copia somente as anotações em Markdown.

Nas configurações Google/Microsoft/e-mail do core, nas configurações genéricas de plugins, na criação de credenciais de Delivery Pipelines, o seletor oferece `categoria · constante · caderno · nome`. O valor não aparece no seletor. Uma referência estável identifica proprietário, caderno e campo; renomear não rompe o vínculo. Uma credencial com constante precisa ter valor para ser vinculada.

As configurações de ambiente persistem a referência `orbit-vault://…`, sem copiar o segredo para o arquivo. A API resolve as referências antes de construir os serviços. O mecanismo existente de configuração informa quando um serviço exige reinicialização; serviços que consultam variáveis a cada operação recebem a referência resolvida em memória ao salvar. A alteração de um valor no cofre atualiza essas variáveis em memória. Delivery resolve a credencial a cada operação e acompanha a rotação sem duplicar o valor.

Chaves necessárias para abrir o próprio cofre, banco, sessão e backups continuam manuais para evitar dependência circular. Não é permitido excluir ou esvaziar uma constante usada por uma configuração de ambiente ou credencial de deploy; primeiro remova o vínculo. Arquivos de configuração e backups separados do cofre continuam no fluxo de backup já existente. O backup separado inclui todos os campos criptografados e continua aceitando arquivos antigos, sem campos.

A restauração independente cria novos cadernos, conforme o comportamento anterior. Para usar os cadernos restaurados em integrações, selecione suas constantes novamente. Ela não troca automaticamente vínculos de cadernos existentes.

## Migração das integrações existentes

Em DEV foram migrados sete valores para quatro cadernos: configuração Google compartilhada, configuração Google Calendar, tokens da conta Google autorizada e token Cloudflare Tunnel. Os arquivos de configuração DEV guardam referências; as conexões mantêm IDs, permissões, conta e runtime. A renovação OAuth Google atualiza os campos criptografados do cofre mantendo as referências. O painel Cloudflare mostra a constante selecionada, e mantém o vínculo ao salvar outras configurações.

A ferramenta `apps/api/src/migrate-integration-credentials.ts` exige aplicação explícita em DEV, lista de arquivos DEV e pasta privada de recuperação. Ela valida as chaves de criptografia e possíveis divergências entre arquivos, guarda uma recuperação criptografada, usa transação para os cadernos e conexões e valida os valores por referência sem imprimi-los. Valores já referenciados são ignorados. Conexões de provedores ainda não suportados pela migração abortam a transação.

A recuperação desta execução está em `dev/data/backups/credential-migrations/`, fora do repositório. Os backups normais das configurações e o backup separado do cofre continuam sendo enviados ao Drive da conta já selecionada.
