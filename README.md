# Orbit

Orbit é uma aplicação Kanban feita com Next.js, NestJS, PostgreSQL e Tailwind CSS. Roda diretamente na máquina, sem Docker.

## Funcionalidades desta etapa

- Acesso por e-mail e senha para uma conta única
- Perfil com nome, avatar, atividade, cartões atribuídos e preferências pessoais
- Temas claro e escuro, cartões compactos, atalhos e preferências de notificações
- Home com Up Next, Highlights, Your Items, conversas, quadros recentes e favoritos
- Quadros organizados por áreas de trabalho, favoritos reordenáveis e visitas recentes
- Cópia de quadros com listas, cartões, etiquetas, checklists e fundo; edição do nome e da descrição com links e menções
- Planos de fundo por cor ou imagem local (PNG, JPEG e WebP até 1,5 MB), guardada no PostgreSQL
- Atividade do quadro com filtro de comentários, link compartilhável e impressão de quadros e cartões
- Fechamento reversível de quadros, reabertura e exclusão permanente pelo proprietário
- Alternador de quadros com painel lateral fixável e pesquisa global de quadros e cartões
- Central de notificações por prazo e menção; alertas do navegador quando autorizados
- Desfazer/refazer de ações compatíveis durante a sessão (títulos, favoritos, movimentação, conclusão, descrição e prazos)
- Listas e cartões com arrastar e soltar, etiquetas, prazos, checklists, atribuições e comentários
- Listas com criação em qualquer posição, cópia e movimentação entre quadros, cores, recolhimento e arquivo reversível
- Ações em lote para mover, arquivar e ordenar cartões; restauração de cartões arquivados pela lista
- Cartões criados em qualquer posição ou em massa por colagem, com interpretação de datas no título
- Descrições em Markdown com barra de formatação e prévia de textos, links, listas, código e imagens
- Etiquetas com 30 cores e opção sem cor, editáveis no quadro; atribuição de membros do quadro
- Datas de início e vencimento com horário, lembrete opcional e recorrência diária, semanal, mensal ou anual
- Filtro de cartões por status e indicador de conclusão na pesquisa global
- Múltiplos checklists por cartão, cópia entre cartões do quadro, colagem em massa, arrastar itens entre grupos e conversão de item em cartão
- Responsável e prazo independentes por item; cinco tipos de campos personalizados por quadro, com valores próprios por cartão
- Arquivos no PostgreSQL, anexos por arraste ou colagem de imagem, links externos e internos, prévia, download e reordenação
- Links reconhecidos de Orbit, GitHub, YouTube e Figma; capas com cor ou imagem em tamanho parcial ou completo
- Cartões normais, modelos reutilizáveis, links de quadros, separadores, links externos com prévia visual e espelhos sincronizados com recolhimento próprio
- Mover e copiar cartões entre listas, quadros e Inbox; cópia com escolha de descrição, datas, etiquetas, membros, checklists, anexos, campos, comentários e capa
- Arquivar e restaurar cartões; exclusão definitiva somente após arquivar
- Seleção de até 20 cartões com Ctrl/Cmd, Shift ou modo de seleção por toque para mover, copiar, arrastar em grupo, arquivar ou mesclar; mesclagens podem ser desfeitas por cinco minutos
- Comentários editáveis com anexos de arquivos, cartões e quadros; links diretos, menções `@card` e `@board`, e acompanhamento de cartão, lista ou quadro
- Cada cartão exibe um endereço de comentário por e-mail. O recebimento exige configurar `COMMENT_EMAIL_DOMAIN` e um provedor para encaminhar mensagens ao endpoint protegido do Orbit

Arquivos podem ter até 10 MB; imagens para capa, até 2 MB. A prévia de links usa informações da URL; vídeos do YouTube também podem mostrar a miniatura pública. O link abre o serviço original.

O cadastro e os convites estão desativados nesta etapa de conta única. Exclusões permanentes não entram no histórico de desfazer.

## Requisitos

- Node.js 20.19+ e npm
- PostgreSQL local ou remoto

## Instalação

1. Crie um banco vazio no PostgreSQL. Exemplo, usando uma conta com permissão:

   ```bash
   createdb orbit
   ```

2. Instale as dependências e prepare as variáveis:

   ```bash
   npm install
   cp .env.example apps/api/.env
   cp .env.example apps/web/.env.local
   ```

3. Edite `DATABASE_URL` em `apps/api/.env` com a conexão real do seu PostgreSQL. Defina `JWT_SECRET` com uma chave aleatória de pelo menos 32 caracteres (por exemplo, gere uma com `openssl rand -hex 32`). Se alterar as portas, ajuste `WEB_ORIGIN` e `NEXT_PUBLIC_API_URL` também.

4. Crie as tabelas, configure a conta inicial e inicie os servidores:

   ```bash
   npm run db:migrate
   npm run dev
   ```

Abra **http://localhost:3000**. A API fica em **http://localhost:4000** e oferece `GET /health` para checagem.

## Conta inicial

- E-mail: `igorhaf@gmail.com`
- Senha: a senha informada na especificação desta etapa

A migração guarda apenas o hash da senha e reconfigura esse acesso a cada execução. Altere a senha inicial antes de disponibilizar o sistema publicamente.

## Comandos

| Comando | Função |
| --- | --- |
| `npm run dev` | Inicia Next.js e NestJS em desenvolvimento |
| `npm run lint` | Verifica o código da API e do front, sem aceitar avisos |
| `npm run lint:fix` | Corrige automaticamente os problemas de lint possíveis |
| `npm run build` | Executa o lint e compila a API e o front |
| `npm run test -w apps/api` | Executa os testes das regras de cartões e automações |
| `npm run test:integration -w apps/api` | Testa automações no PostgreSQL com dados temporários |
| `npm run db:migrate` | Aplica o esquema SQL e prepara a conta inicial |
| `npm run start -w apps/api` | Inicia a API compilada |
| `npm run start -w apps/web` | Inicia o front compilado |

O SQL fica em `apps/api/sql/schema.sql`.

## Automação

Abra **Automação** no cabeçalho do quadro ou **Automatizar lista** no menu de uma lista. Botões cadastrados aparecem no cabeçalho do quadro ou no detalhe do cartão. O editor oferece gatilhos por evento, vencimento, agenda e botões, condições combinadas, até 20 ações ordenadas, tags, cópias e histórico. Cópias para outros quadros exigem mapear listas, etiquetas, pessoas e campos e começam pausadas.

`npm run db:migrate` aplica também `apps/api/sql/automations.sql`. Eventos são registrados na mesma transação que altera os cartões, inclusive em operações em massa. O worker da API consulta a fila a cada cinco segundos. Cada regra/evento tem chave única; falhas revertem todas as ações daquela execução e ficam no histórico. Cadeias são limitadas a cinco níveis e uma mesma regra não pode executar duas vezes na cadeia. Uma execução alcança até 500 cartões; referências de cascata são anexos de cartões do mesmo quadro. Separadores, links e espelhos não são alvos de operações em massa.

Agendamentos diários e semanais usam o fuso configurado. Intervalos têm mínimo de cinco minutos. Após uma parada, um agendamento atrasado executa uma vez e calcula a próxima ocorrência; não reproduz todas as ocorrências perdidas. Regras de vencimento usam minutos relativos ao prazo: `-1440` significa um dia antes e `0` significa no vencimento. Uma ocorrência de prazo é processada uma vez por cartão/regra; erros ou condições não atendidas ficam registrados. Prazos anteriores à criação da regra não são recuperados.

Textos aceitam `{{title}}`, `{{description}}`, `{{list}}`, `{{board}}`, `{{user}}`, `{{members}}`, `{{due_date}}` e `{{custom:ID_DO_CAMPO}}`. Cálculos de data aceitam `now + 2 days`, `due - 30 minutes` e `today + 3 business_days`; formatos de variável: `{{now + 2 days|date}}`, `{{now|time}}` ou `iso`. Cálculos usam UTC. Dias úteis excluem sábados e domingos, sem calendário de feriados. O editor exibe os identificadores dos campos. Sugestões surgem após três movimentos manuais para a mesma lista em trinta dias e sempre exigem revisão e salvamento.

Relatórios disponíveis: Board Snapshot, Due Soon (sete dias), Overdue Cards, My Cards e personalizado com filtros, Markdown e variáveis. Destinatários, assunto e mensagem por cartão são configurados na ação; use um gatilho agendado para envio periódico. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`, `SMTP_USER` e `SMTP_PASSWORD` em `apps/api/.env`. O transporte exige TLS. Sem SMTP, as mensagens permanecem na fila e a falta de configuração aparece no histórico. Erros de envio são tentados até cinco vezes, com cinco minutos entre tentativas. SMTP não garante exatamente uma entrega se a conexão cair após o servidor aceitar a mensagem; cada mensagem tem um Message-ID estável.

Para testes visuais, com API e web em execução e Chromium disponível, use `npm run test:browser -w apps/api`. Os testes criam um quadro temporário e removem seus dados ao terminar. Para instalar o navegador de teste: `npx playwright install chromium`.

Antes de cada commit, execute `npm run build`. Se houver erro ou aviso de lint, corrija e repita o build antes de criar o commit.
