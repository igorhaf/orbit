# Webhooks Orbit e eventos acadêmicos Suindá

Gestores do workspace podem assinar `record.created`, `record.updated` e eventos de domínio declarados por plugins habilitados. `GET /workspaces/:workspace/webhooks/event-types` publica os tipos disponíveis para aquela instância/workspace; a UI não presume que um produto ou adaptador está instalado. A gestão usa `POST /workspaces/:workspace/webhooks`; `GET` retorna endpoint, tipos escolhidos e estado redigido das entregas; `DELETE` remove a assinatura e o histórico enfileirado.

## Compatibilidade e payloads

O envelope legado de `record.created` e `record.updated` permanece igual: `id`, `type`, `workspace_id`, `record` (com identificador, plugin, tipo, estado e revisão) e `occurred_at`. Não envia título ou payload do registro.

Os eventos acadêmicos usam contrato `version: 1` e envelope separado: `id`, `type`, `version`, `workspace_id`, `resource` (identificador opaco, tipo e revisão) e `occurred_at`. Não enviam nome, e-mail, título, nota, valor, referência de pagamento, código público de certificado, ator nem payload do registro.

O filho Suindá `suinda-domain-webhooks` declara, com versão e rótulo, estes tipos acadêmicos:

- `suinda-learning.enrollment.completed`: entrada da matrícula no estado concluído.
- `suinda-learning.payment.recorded`: registro de recebimento financeiro; não inclui créditos de bolsa, isenções ou reembolsos.
- `suinda-learning.payment.refunded`: cada registro de reembolso, inclusive parcial.
- `suinda-learning.certificate.issued`: entrada do certificado no estado emitido, incluindo emissão automática, manual e por marco.
- `suinda-learning.certificate.revoked`: transição de emitido para revogado.

Plugins Orbit podem adicionar eventos por `PluginDefinition.recordEvents`: declaram tipos com versão/rótulo, apontam o plugin de origem e implementam o mapeamento de snapshot. O motor valida que o filho depende da fonte, rejeita emissões fora da declaração e grava evento e entrega na transação do snapshot. Suspender o plugin provedor retira seus tipos das opções; a outbox genérica mantém o processamento dos próprios eventos.

Uma atualização de um registro que continua no mesmo estado não repete um evento de transição. A chave de idempotência é workspace, recurso, revisão e tipo do evento. O evento e suas entregas entram na mesma transação do snapshot do registro; rollback não deixa evento publicável. O evento só é gravado se existir assinatura ativa compatível. As linhas correspondentes são bloqueadas para leitura compartilhada durante a transação, prevenindo eventos órfãos se uma assinatura for desativada simultaneamente.

## Segurança e entrega

Entregas levam `X-Orbit-Signature-256: sha256=<hex>`, HMAC-SHA256 sobre o corpo JSON exato. A criação mostra o segredo de 256 bits uma vez; Orbit o cifra em repouso com AES-256-GCM. Configure `ORBIT_WEBHOOK_ENCRYPTION_KEY` com pelo menos 32 caracteres estáveis antes de criar assinaturas (`openssl rand -hex 32` gera um valor adequado). Perdê-la ou alterá-la torna os segredos existentes ilegíveis; recrie as assinaturas para rotacionar.

Destinos aceitam somente HTTPS na porta 443, sem redirects. Endereços privados, loopback, link-local, reservados ou respostas DNS mistas são rejeitados; a conexão fixa o endereço validado contra DNS rebinding. O outbox entrega de forma idempotente por assinatura e evento, com até oito tentativas e backoff exponencial limitado a seis horas. Erros HTTP 4xx permanentes e destinos inseguros vão para `dead_letter`. A interface não revela corpo de requisição, segredo ou conteúdo da resposta do destino.

As migrações 190 e 191 acrescentam `event_version` e aceitam nomes de eventos por namespace de plugin; subscriptions antigas continuam válidas e entregas genéricas pendentes mantêm o envelope legado.
