# Validação Alexa Orbit

Da raiz DEV:

```sh
ORBIT_SELENIUM_DB_HOST=172.22.0.3 node .orbit/validations/alexa-orbit/live.integration.mjs
```

A validação salva temporariamente uma configuração de teste do novo plugin, ativa o simulador DEV explicitamente e cria um quadro descartável. Valida criação nativa de tarefa, compra e card agendado; repetição simultânea de requestId; timezone; destinos inválidos; rejeições públicas sem assinatura; desativação e a UI em 320, 390 e 1440 px. Restaura a configuração e o estado de ativação originais e apaga seus próprios dados ao terminar. Não modifica configurações de outros plugins nem usa bypass de assinatura pública.

Testes unitários:

```sh
npm test -w apps/api
```

Build com lint e typecheck:

```sh
npm run build
```

O teste Amazon real e o Build Model devem ser executados no Developer Console após criar a skill; ver `docs/plugins/alexa-orbit.md`.

## Interpretação por IA

```sh
npx tsx --tsconfig apps/api/tsconfig.json .orbit/validations/alexa-orbit/ai.integration.ts
docker exec -w /home/meada/projetos/orbit/apps/api orbit-dev npx tsx --tsconfig tsconfig.json ../../.orbit/validations/alexa-orbit/ai-classifier.live.ts
```

`ai.integration.ts` usa respostas de IA controladas e serviços nativos reais em um quadro descartável. Cria um schema de teste pelo administrador do contêiner DEV, sem ampliar permissões da aplicação, e remove schema/quadro ao terminar. Valida fila persistida, criptografia, claims concorrentes, idempotência, encaminhamento, horários, complemento de conversa, isolamento entre usuários Alexa, desativação durante inferência, saída inválida e não repetição de efeitos interrompidos. Não modifica a configuração real do plugin.

`ai-classifier.live.ts` chama o Codex autenticado real para validar classificação de compra e pedido incompleto; não cria cards nem modifica configurações. Consome a cota normal da conta. O teste Amazon continua necessário para reconhecimento de voz e Build Model.

```sh
node .orbit/validations/alexa-orbit/voice-model.browser.mjs
```

Validação somente leitura do modelo genérico e UI: copiar JSON, consultar pedidos, toque e ausência de overflow em 320/390/1440 px. Não salva configurações nem cria pedidos.

O teste da fila também verifica drenagem contínua de dois pedidos, limite de consultas de estado e esforço baixo por voz. A validação real inclui compromisso obtido por complemento com histórico. Para comparar esforço global e baixo, use `ai-classifier.live.ts --benchmark`; os tempos são amostras, não uma garantia de latência da conta ou da rede.
