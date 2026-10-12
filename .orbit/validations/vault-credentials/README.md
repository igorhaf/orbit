# Credenciais estruturadas do cofre

Executar da raiz do código DEV:

```sh
ORBIT_SELENIUM_DB_HOST=172.22.0.3 node .orbit/validations/vault-credentials/vault-credentials.selenium.mjs
```

O teste usa a API e interface DEV, cria cadernos descartáveis e os remove ao terminar. Não altera credenciais reais nem salva configurações de plugins. Verifica 320, 390 e 1440 px, toque, autosave, recarga, anotações existentes, valores mascarados, ausência de overflow e seletor por categoria/constante. Campos sem constante e valores secretos não aparecem no catálogo.

Teste PostgreSQL com esquema isolado (requer acesso Docker para obter credenciais administrativas sem imprimi-las):

```sh
cd apps/api
ORBIT_SELENIUM_DB_HOST=172.22.0.3 npx tsx --test src/vault-credentials.integration.spec.ts
```

Verifica referências por proprietário, configuração de plugins, bloqueio de referências em chaves de inicialização, resolução e rotação em deploys, proteção contra exclusão e backup/restauração criptografados.

Validação dos dados reais migrados (somente leitura):

```sh
ORBIT_SELENIUM_DB_HOST=172.22.0.3 node .orbit/validations/vault-credentials/migration-live.browser.mjs
```

Verifica os quatro cadernos de Google compartilhado, Google Calendar, conta Google e Cloudflare; campos mascarados, anotações e selects já selecionados em 390 e 1440 px. As credenciais reais não são impressas nem alteradas.
