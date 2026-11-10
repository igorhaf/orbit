# Filas e retomada automática

Na barra de limites, **Retomada automática** fica à esquerda de Pausar/Retomar fila e **Gerenciar filas** à direita. A opção é persistida nas preferências do usuário (`codexQueueAutoResume`) e inicia desativada.

A retomada opera no backend, mesmo sem navegador aberto. O monitor verifica o protocolo de cotas da conta Codex local. Retoma somente pausas por cota, com opção habilitada, após confirmar disponibilidade e renovação de todas as janelas esgotadas (5h/semanal). Se outra janela ainda estiver esgotada ou faltarem dados, preserva a pausa. Pausas manuais permanecem, e execuções em andamento não são interrompidas.

Em `/queues`, os fluxos são separados em prompts, comentários, execuções de cartões e pipelines de deploy. Os controles Codex afetam conjuntamente as três primeiras filas daquele usuário; delivery tem controle independente. Itens ativos são exibidos integralmente; o histórico opcional inclui até 50 registros recentes por fluxo/usuário. Links levam ao cartão usando seu token de URL. Respostas e aprovações continuam sendo resolvidas nos fluxos nativos.

ROOT vê filas de todos os usuários e pode editar suas preferências. Outros usuários veem somente os próprios itens autorizados e não alteram preferências alheias. Privilégios `queues.read`/`queues.write` permanecem separados. O catálogo não retorna prompts, respostas ou corpos dos comentários.

API: `GET /codex/queue`; `PATCH /codex/queue` com `paused` e/ou `autoResume`, e `userId` opcional (terceiros apenas ROOT); `GET /codex/queues` para o catálogo. Estas rotas de gerenciamento continuam disponíveis quando IA está desativada; execução segue respeitando disponibilidade do plugin.

Validação: testes de protocolo/quota em `codex-limits.spec.ts`, preferências em `queue-management.spec.ts` e navegador em `.orbit/validations/queues/queues.selenium.mjs`. Os testes usam uma conta isolada pausada e não executam prompts. O rollover real de 5h/semanal é validado por snapshots controlados do protocolo, sem esperar horas nem alterar a cota da conta.
