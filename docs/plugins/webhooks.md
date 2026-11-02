# Webhooks Orbit

O plugin `webhooks` oferece assinaturas no escopo de um workspace para `record.created` e `record.updated`, além de eventos de domínio versionados que plugins podem declarar no contrato Orbit. Quando há uma assinatura ativa para o tipo de evento, evento e entregas são gravados na mesma instrução transacional do snapshot; sem correspondência, nenhuma linha de evento ou entrega é persistida. Uma chave única por workspace, registro, revisão e tipo torna o enqueue idempotente.

## Conteúdo e segurança

O envelope genérico contém o identificador do evento e workspace, metadados mínimos do registro (identificador, plugin, tipo, estado e revisão) e a data de ocorrência. Eventos de domínio também incluem versão do contrato. Título e payload do registro não são enviados nem persistidos na fila de eventos.

Segredos de destino são gerados uma vez, exibidos apenas na criação e armazenados com AES-256-GCM usando `ORBIT_WEBHOOK_ENCRYPTION_KEY` (mínimo de 32 caracteres). Cada requisição inclui `x-orbit-signature-256: sha256=<hex>` calculado como HMAC-SHA256 sobre o corpo JSON exato. O consumidor deve comparar assinaturas em tempo constante e rejeitar mensagens sem assinatura válida.

Destinos precisam usar HTTPS na porta padrão, sem usuário ou senha embutidos. A resolução DNS rejeita endereços privados, reservados, loopback e link-local; a conexão usa o IP público validado para reduzir risco de DNS rebinding. Respostas têm limite de tamanho e tempo. Falhas temporárias usam backoff exponencial limitado; após oito tentativas, respostas permanentes ou destino inseguro, a entrega é marcada como `dead_letter`.

## Ativação

Configure `ORBIT_WEBHOOK_ENCRYPTION_KEY` no ambiente da API. Administradores do workspace podem criar, consultar e remover assinaturas pela seção Webhooks na página de Workspaces. A migração `149_orbit_webhooks.sql` cria as tabelas, `150_plugin_webhook_events.sql` libera tipos de evento declarados por plugins, `151_webhook_event_types_reject_nulls.sql` reforça a validação dos tipos e `152_webhook_event_version.sql` garante a versão obrigatória dos eventos também em bancos existentes.
