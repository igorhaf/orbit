# Checkout do Mercado Pago

Suindá oferece checkout online para matrículas pagas em BRL usando Mercado Pago Checkout Pro. A aplicação cria uma preferência idempotente para o valor líquido ainda devido; somente a API consulta o provedor. O navegador recebe apenas o link `init_point` HTTPS permitido do Mercado Pago.

## Configuração

1. Use uma conta Mercado Pago da instituição e gere o Access Token apropriado ao ambiente de teste ou produção.
2. Configure a notificação de pagamentos para `https://<API_PUBLIC_URL>/public/suinda/payments/mercado-pago/webhook?workspace=<UUID_DO_WORKSPACE>` e copie o segredo de assinatura de webhook emitido pelo Mercado Pago.
3. Configure `API_PUBLIC_URL` e `WEB_ORIGIN` com origens públicas HTTPS. O provedor exige HTTPS para a notificação e para os retornos.
4. Em **Suindá → Relatórios acadêmicos**, a gestão informa Access Token e segredo de webhook para cada workspace. Os valores são cifrados pelo cofre de integrações do Orbit e nunca retornam à interface depois de salvos.
5. Aplique as migrações até `171_suinda_payment_review_provider_status.sql` antes de habilitar esta versão da API.

O token precisa ter permissão para criar preferências e consultar pagamentos da conta configurada. Use credenciais de teste para validar o fluxo antes de habilitar a conta real. A aplicação não armazena dados de cartão.

## Confirmação e controles

- O aluno autenticado só pode iniciar ou consultar checkout da própria matrícula; o e-mail da conta precisa estar confirmado.
- O checkout usa o saldo não pago da matrícula, fixado na revisão curricular, limitado a BRL. Baixas, créditos, reembolsos e isenções já registrados são considerados.
- A chave de operação e o cabeçalho `X-Idempotency-Key` impedem criar preferências duplicadas para a mesma operação.
- Cada preferência expira após quatro dias; esse prazo evita checkouts pendentes permanentes e cobre o prazo recomendado pelo provedor para a liquidação de meios offline.
- O webhook valida a assinatura HMAC do Mercado Pago e depois consulta a API oficial de pagamentos. O corpo recebido não é usado como prova de quitação.
- Referência externa, workspace, moeda, valor, preferência e matrícula são conferidos no servidor antes de gravar um lançamento financeiro imutável. Notificações repetidas são deduplicadas.
- Pagamento aprovado após cancelamento, pagamento duplicado ou acima do saldo fica em revisão e não gera baixa automática.
- O status real do Mercado Pago fica separado do motivo interno da revisão. Depois que um checkout entra em revisão, eventos posteriores não fecham nem removem o caso. A única conciliação disponível é para pagamento aprovado após cancelamento; devoluções, chargebacks e excedentes permanecem em revisão.
- Para pagamento aprovado após o cancelamento da matrícula, a gestão pode registrar a conciliação com justificativa. A API consulta o pagamento novamente, confere a preferência, a referência externa, o valor e a moeda, impede duplicidade pelo ID do provedor e grava o lançamento imutável, a atualização da matrícula e a auditoria na mesma transação. A ação não aparece para estornos, chargebacks ou valores acima do saldo.
- A página do aluno mostra o estado recebido pelo webhook. O retorno do navegador ao Suindá não confirma pagamento.

## Escopo ainda dependente

A configuração e o uso real dependem de credenciais e webhook cadastrados no painel do Mercado Pago e de endpoints públicos HTTPS. O fluxo online é BRL e Checkout Pro; ainda não há cobrança programada de parcelas nem conciliação de excedentes, execução automática de reembolsos nem conciliação automática de estornos/chargebacks. Esses eventos ficam sinalizados para revisão institucional; a ação disponível à gestão só registra recebimentos aprovados após cancelamento, não resolve devoluções, excedentes nem chargebacks. Validar com credenciais de teste e posteriormente com transações reais controladas antes de abrir o checkout aos alunos.

Separadamente, `suinda-accounting` aceita importação manual de um CSV de liquidação normalizado, com pagamentos, tarifas, estornos, chargebacks e valor líquido por referência; valida que os componentes somem ao líquido e pode exportar tarifas/chargebacks no diário após configurar contas contábeis. Isso não consulta a API Mercado Pago, não verifica o estado do provedor, não altera pagamentos ou reembolsos e não fecha os casos de revisão acima. É uma ferramenta genérica de intercâmbio, não um adaptador Mercado Pago.

## Relatório Dinheiro em conta via API

Gestores do workspace também podem iniciar uma tarefa de relatório Mercado Pago no painel **Suindá → Relatórios acadêmicos → Conciliação por extrato**. A integração chama `POST /v1/account/settlement_report` com o intervalo em UTC, consulta `GET /v1/account/settlement_report/task/:taskId` e, quando o provedor marca a tarefa como processada, baixa o CSV em `GET /v1/account/settlement_report/:fileName`. O Access Token é obtido internamente pelo plugin filho a partir do cofre Orbit e enviado exclusivamente no cabeçalho `Authorization: Bearer`; não é aceito como parâmetro nem devolvido ao navegador. A integração não altera configurações de relatório da conta no Mercado Pago.

O adaptador aceita arquivos CSV de até 1 MB e até 1.000 linhas normalizadas. Só importa `SETTLEMENT`, `REFUND` e `CHARGEBACK` em BRL, usando `SOURCE_ID` como referência técnica; o identificador do pagamento é temporariamente prefixado como `Mercado Pago <SOURCE_ID>` para corresponder ao formato do ledger do checkout. Tarifas são calculadas como a diferença assinada entre `SETTLEMENT_NET_AMOUNT` e `TRANSACTION_AMOUNT`; a soma de cada grupo é validada pelo importador existente antes de persistir. Linhas de saque, disputa e outras operações de saldo são ignoradas e informadas na resposta. Um CSV XLSX, moeda diferente, dados ausentes/incompatíveis ou relatório acima dos limites é recusado, sem gravação parcial. O lote conserva apenas hash de referência, metadados mínimos e valores necessários à revisão append-only; não armazena o arquivo bruto nem envia ou altera pagamentos e saldos.

As rotas são `POST /extensions/suinda-accounting/workspaces/:workspaceId/mercado-pago/reports` (`{ from, to }`, datas `AAAA-MM-DD`) e `GET /extensions/suinda-accounting/workspaces/:workspaceId/mercado-pago/reports/:taskId`. O POST solicita a geração; consultas GET enquanto a tarefa está pendente retornam seu estado sem importar. Depois de processada, a consulta baixa e importa idempotentemente aquele task ID. Somente gestor do workspace pode solicitar/importar porque o relatório abrange toda a conta financeira, sem recorte por unidade; gestão limitada a unidade não recebe os controles. Importar esse extrato registra evidência financeira, não decide casos de revisão do checkout nem efetua reembolsos. `32.12` continua parcial até validar com conta de teste Mercado Pago, comprovar correspondência real de referências/cabeçalhos e cobrir os movimentos financeiros exigidos fora de checkout.

## Referências do provedor

- [Criar preferência Checkout Pro](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/create-preference/post)
- [Definir vigência da preferência](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/additional-settings/term-of-preference)
- [Notificações de pagamento](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/payment-notifications)
- [Criar relatório Dinheiro em conta](https://www.mercadopago.com.br/developers/pt/reference/settlements-report/create-report/post)
- [Consultar tarefa do relatório](https://www.mercadopago.com.br/developers/pt/reference/settlements-report/query-task-status/get)
- [Buscar/baixar relatório](https://www.mercadopago.com.br/developers/pt/reference/settlements-report/download-report/get)
- [Campos dos relatórios Dinheiro em conta](https://www.mercadopago.com.br/developers/pt/docs/reports/account-money/report-fields)
