# Remoção da integração de listas

## Auditoria anterior à remoção

Git consultado com `log`, `status`, `diff` e `show HEAD:apps/api/package.json`. A implementação estava nas alterações locais, sem commit exclusivo a reverter. Nenhum reset, commit, alteração de branch ou rollback amplo foi realizado.

A feature era integralmente exclusiva: modelo normalizado TODO/SHOP; provider Amazon Data Portability; OAuth Login with Amazon; validador de notificações SNS; sync, prévias, conflitos e bindings; controller `/alexa`; registro de plugin; scheduler interno de 60 segundos; eventos de atualização de quadro emitidos pelo serviço. Não havia alteração do event bus ou scheduler global, nem novos repositories ou dependências externas exclusivos. Não havia página frontend própria: os componentes eram acoplados ao catálogo e aos menus/badges dos quadros.

### Arquivos removidos (21)

- `apps/api/src/alexa/model.ts`
- `apps/api/src/alexa/provider.ts`
- `apps/api/src/alexa/notifications.ts`
- `apps/api/src/alexa/alexa.service.ts`
- `apps/api/src/alexa/alexa.plugin.ts`
- `apps/api/src/alexa/alexa.spec.ts`
- `apps/api/src/alexa/alexa.integration.spec.ts`
- `apps/web/plugins/alexa/AlexaPanel.tsx`
- `apps/web/plugins/alexa/AlexaColumn.tsx`
- `docs/plugins/alexa.md`
- `.orbit/validations/alexa/README.md`
- `.orbit/validations/alexa/alexa.browser.mjs`
- `.orbit/validations/alexa/alexa.live.browser.mjs`
- `.orbit/validations/alexa/panel-320.png`
- `.orbit/validations/alexa/panel-390.png`
- `.orbit/validations/alexa/panel-1440.png`
- `.orbit/validations/alexa/live-plugin-390.png`
- `.orbit/validations/alexa/live-plugin-1440.png`
- `.orbit/validations/alexa/live-column-390.png`
- `.orbit/validations/alexa/live-column-1440.png`
- `.orbit/validations/alexa/live-failure.png`

Também removidos os artefatos compilados exclusivos `apps/api/dist/alexa` e o build isolado `apps/web/.next-validation/alexa`.

### Arquivos existentes alterados (5)

- `apps/api/src/main.ts`: imports, providers, controller, registro/default da Alexa e parser exclusivo SNS removidos.
- `apps/web/app/plugins/page.tsx`: import e ramo de configuração específicos retirados.
- `apps/web/components/board-list.tsx`: hook, badge, status e configuração de coluna retirados.
- `apps/api/package.json`: retirados os testes exclusivos; registrado o novo teste da migration de remoção.
- `docs/features/vault-credentials.md`: retirada apenas a menção ao painel removido.

### Arquivos adicionados

- `apps/api/sql/migrations/062_remove_alexa_lists.sql`
- `apps/api/src/plugins/removed-list-integration.integration.spec.ts`
- `.orbit/validations/removed-list-integration/live.browser.mjs`
- Este relatório.

## Migrations e banco

`061_alexa.sql` estava aplicada em DEV e foi preservada byte a byte: o migrador exige checksum imutável. A migration `062_remove_alexa_lists.sql` foi criada e aplicada pelo comando normal `docker exec orbit-dev npm run db:migrate -w apps/api`, incluindo o backup pré-migração existente.

A nova migration remove somente `alexa_previews`, `alexa_card_bindings`, `alexa_column_bindings`, `alexa_exports`, estados OAuth, conexões e configuração de plugin cujo `plugin_id` é exatamente `alexa`. Não utiliza CASCADE amplo nem altera colunas de tabelas genéricas. Os quatro objetos estavam vazios; não existiam contas, configurações de plugin ou estados OAuth dessa integração em DEV. Consulta somente leitura a PROD confirmou zero tabelas Alexa e ausência da migration original; não foi necessário aplicar remoção nesse banco.

Os totais de usuários, projetos, quadros, listas e cards em DEV foram comparados antes/depois e permaneceram iguais. O teste isolado também criou cards efetivamente vinculados e confirmou sua preservação após aplicar a remoção duas vezes.

## Configurações e dependências

Removidas do catálogo as definições `ALEXA_CLIENT_ID`, `ALEXA_CLIENT_SECRET`, `ALEXA_REDIRECT_URI`, `ALEXA_PORTABILITY_REGION`, `ALEXA_SNS_TOPIC_ARN`. Nenhuma dessas variáveis existia nos dois arquivos de configuração DEV inspecionados; não havia secrets exclusivos persistidos a apagar. Nenhum valor foi impresso.

Nenhuma dependência de package manager era exclusiva da feature, portanto nenhum pacote ou lockfile foi alterado. Criptografia, OAuth genérico, registries, notificações, event bus e demais plugins foram preservados.

## Verificações executadas

- `npm run build`: lint da API e web com zero warnings, compilação TypeScript API/web e build Next passaram.
- `npm test -w apps/api`: 143 testes passaram.
- Teste PostgreSQL isolado da migration: passou, incluindo repetição idempotente e preservação de cards vinculados e registros de outro plugin.
- `npm run test:selenium:mobile`: passou em 320, 375, 430 e 768 px, com toques e rotas principais.
- `live.browser.mjs`: passou em 390 e 1440 px; catálogo e quadro abrem sem UI ou chamadas da integração retirada.
- API real: 16 rotas antigas mais a configuração do plugin retornam 404; criação, edição, movimentação, arquivamento e exclusão definitiva de card passaram no fluxo original.
- Cloudflare permanece CONNECTED e em execução. Hashes de 15 arquivos de código/UI/testes/documentação/validações permaneceram iguais. Credencial criptografada e configuração persistida permaneceram iguais.
- Busca global no código fonte/documentação/testes, excluindo dependências e builds: referências restantes limitadas à migration histórica, migration de remoção, testes da remoção e este relatório. Nenhum controller, job ou dependência funcional permanece.

As únicas menções intencionais são histórico imutável de migrations e provas da retirada. Backups antigos e histórico Git não são apagados.

## Repetir as validações direcionadas

Na raiz do código DEV:

```sh
ORBIT_SELENIUM_DB_HOST=172.22.0.3 node .orbit/validations/removed-list-integration/live.browser.mjs
```

Em `apps/api`:

```sh
ORBIT_SELENIUM_DB_HOST=172.22.0.3 npx tsx --test src/plugins/removed-list-integration.integration.spec.ts
```

O teste de navegador cria apenas um quadro descartável, valida o fluxo nativo dos cards e remove seus próprios dados ao terminar. Não controla o lifecycle do Cloudflare nem salva sua configuração.
