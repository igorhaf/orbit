# Entrega de notificações

O Orbit pode entregar notificações existentes por e-mail e por Web Push. A central no aplicativo continua sendo a origem e permanece independente dos canais externos.

## E-mail

Em **Perfil → Configurações → Notificações e atalhos**, cada pessoa pode ativar **Notificações por e-mail**. A entrega exige e-mail verificado, a preferência global de notificações ativa e um SMTP configurado (`SMTP_HOST`, `SMTP_FROM` e, quando necessário, porta/TLS/credenciais). A outbox é criada transacionalmente, impede duplicação e repete falhas temporárias até cinco vezes. Desativar uma preferência cancela, na mesma transação da alteração do perfil, as entregas pendentes dos canais afetados. Uma entrega `sending` abandonada pelo processo após cinco minutos é marcada como `failed` se já atingiu o limite de tentativas.

## Web Push

Web Push é opcional e depende de HTTPS (ou localhost), suporte do navegador e chaves VAPID. Gere as chaves no arquivo de ambiente da API:

```sh
npm run web-push:keys -w apps/api -- --config-path ../data/config/api.env --subject mailto:contato-da-instituicao
```

O contato deve pertencer à instituição; também se aceita uma URL pública HTTPS. O comando não exibe os segredos, grava o arquivo com permissão `0600` e se recusa a substituir configuração VAPID já preenchida. Depois, reinicie a API para carregar as variáveis.

No perfil, **Notificações push** ativa ou remove a inscrição apenas do navegador atual. `notifications` (preferência global) continua controlando a criação e o envio. As rotas autenticadas são `GET /notifications/push/config`, `PUT /notifications/push/subscription` e `DELETE /notifications/push/subscription`. O endpoint precisa ser HTTPS na porta padrão, não pode conter credenciais e deve resolver exclusivamente para endereços públicos; a API fixa o endereço resolvido também no envio, evitando DNS rebinding. As chaves recebidas são limitadas e validadas, a conta é revalidada antes de enviar e inscrições expiradas são removidas. As entregas repetem erros de rede, HTTP 429 e erros 5xx até cinco vezes; erros permanentes encerram a tentativa. Um envio `sending` abandonado após cinco minutos é marcado como `failed` ao atingir o teto.

As migrations `149_notification_email_delivery` e `150_notification_web_push` criam as outboxes e a inscrição por dispositivo. Aplique as migrations pelo fluxo normal Orbit antes de ativar os canais. Sem SMTP ou VAPID, as respectivas entregas ficam desativadas; o restante da central continua funcionando. A suíte integral atual da API cobre a recuperação dos limites, opt-out transacional, rejeição de endereços internos e pinning DNS (323/323 no marco de 25/10/2026).
