# Validação Selenium de responsividade mobile

Roda a aplicação DEV em Chrome com emulação mobile e eventos de toque reais. A jornada verifica o menu e alvos de toque, navegação para Calendário, largura/overflow das páginas principais e abertura/fechamento de um cartão.

```sh
ORBIT_SELENIUM_DB_HOST=172.22.0.2 npm run test:selenium:mobile
```

O banco do DEV neste host não publica sua porta no host. Use o IP acessível do contêiner de banco em `ORBIT_SELENIUM_DB_HOST`; `172.22.0.2` é o endereço atual e pode mudar se o contêiner for recriado. A aplicação é aberta em `http://127.0.0.1:3001` por padrão. Também é possível informar `ORBIT_SELENIUM_BASE_URL` para outra instância de validação. A jornada cria e apaga apenas um quadro temporário próprio.
