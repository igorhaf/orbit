# Dependências ao vivo

```sh
ORBIT_SELENIUM_DB_HOST=172.22.0.3 node .orbit/validations/plugin-dependencies/plugin-dependencies.selenium.mjs
```

Usa dois navegadores independentes autenticados em DEV. Uma mudança na primeira sessão ou pela API deve aparecer na segunda em até 4,5 s, antes da reconciliação periódica de 15 s. Testa base desligada, causa de suspensão, filho explicitamente desligado, reativação, toque em celular, quatro larguras e recarga.

Altera IA e desenvolvimento temporariamente; restaura estados originais em finally. Não executa prompts. Execute com a API estável, após o watcher terminar o build.
