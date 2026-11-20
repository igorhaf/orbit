# Alexa · Orbit por voz

Plugin opcional `alexa-orbit` para uma **Alexa Custom Skill privada/de desenvolvimento**, nome **Orbit**, invocation name **orbit**, idioma **pt-BR**. Cria tarefas, compras e compromissos pelos serviços normais do Orbit. Ele inicia desativado e sem credenciais ou destinos fictícios.

## Arquitetura e serviços reutilizados

O `PluginRegistry` registra capacidades, ativação e contribuição de configuração. O controller Nest utiliza o servidor HTTP existente. Configuração e idempotência ficam nas tabelas exclusivas da migration `063_alexa_orbit_voice.sql`. Não há OAuth, account linking ou consulta à Amazon no startup. A migration `064_alexa_orbit_ai_jobs.sql` acrescenta a fila persistente de interpretação por IA, processada pelo plugin a cada dois segundos enquanto ativado.

O modelo atual usa `OrbitMessageIntent` com `AMAZON.SearchQuery` como transporte de fala e `OrbitStatusIntent` para acompanhamento. A IA local do Orbit classifica a fala; os serviços usam os destinos configurados, nunca IDs sugeridos pelo modelo. Os handlers antigos continuam aceitos para compatibilidade com skills ainda não reconstruídas. As operações usam os application services do plugin:

- Tarefa: `Service.createCard`, na coluna escolhida.
- Compra: a mesma `Service.createCard`, na coluna escolhida.
- Compromisso em calendário gravável: `CalendarService.create`, respeitando o provider, permissões e regras existentes.
- Compromisso em “Cards agendados”: `Service.createCard` e `Service.updateCard` com `schedule`. Esse calendário nativo é somente leitura pela interface de providers e deriva seus eventos de cards agendados. Por isso ele exige quadro e coluna para criar o card.

Nenhum handler faz INSERT em cards, eventos, boards ou lists. O bridge registrado no módulo passa as operações do core ao plugin sem duplicar sua lógica. O plugin só grava configuração, requests e jobs de voz nas suas próprias tabelas.

`configurable` é um metadado opcional do contrato do plugin para painéis com configuração própria. Plugins que não o declaram mantêm o cálculo anterior baseado nas variáveis de ambiente.

## Configurar no Orbit

1. Abra **Plugins → Alexa · Orbit por voz → Configurar**.
2. Informe o **Alexa Skill ID**. Opcionalmente selecione uma constante do cofre com esse ID; o vínculo é guardado no próprio plugin.
3. Informe os **userIds Alexa autorizados**, um por linha. Copie `context.System.user.userId` ou `session.user.userId` do JSON de uma chamada de teste no Developer Console. Como não há Account Linking, essa lista determina quais contas Alexa podem criar conteúdo no Orbit do proprietário da configuração. Nenhum primeiro usuário é autorizado automaticamente.
4. Escolha quadro e coluna para tarefas e compras. Os IDs são persistidos, e propriedade, associação e disponibilidade são verificadas ao salvar e a cada criação.
5. Escolha o calendário. Para o calendário nativo de cards agendados, escolha também quadro e coluna.
6. Escolha o fuso IANA do calendário/Orbit. Se o calendário tiver um fuso, ele pode ser usado; caso contrário, informe explicitamente. Não há fallback silencioso para UTC ou um fuso brasileiro.
7. Opcionalmente informe o endpoint público HTTPS para copiar ao console. Esse campo não cria rotas, DNS, tunnels ou qualquer infraestrutura.
8. Salve e use **Testar configuração**. Essa ação verifica os destinos sem criar conteúdo.
9. Ative o plugin no catálogo quando a configuração real estiver pronta.

Destinos removidos, arquivados ou calendários de providers desativados tornam o health inválido. Não há fallback para outro destino nem criação de um novo calendário pelo plugin.

## Endpoint

Na API existente:

```text
POST /integrations/alexa/orbit
```

Requisições aceitas retornam HTTP 200 com o envelope Alexa; a rota não usa o status 201 padrão do Nest para POST. Não há porta fixa nem servidor adicional. A web do Orbit encaminha o caminho `/integrations/alexa/orbit` à API. O proxy com prefixo `/api` também continua disponível:

```text
POST /api/integrations/alexa/orbit
```

Se a infraestrutura pública encaminha diretamente à API, use o caminho sem `/api`. Escolha o endereço correspondente à sua infraestrutura. O plugin não importa nem controla qualquer serviço de tunnel ou DNS.

## Criar a skill manualmente no Alexa Developer Console

1. Abra <https://developer.amazon.com/alexa/console/ask> e escolha **Create Skill**.
2. Nome: **Orbit**. Idioma: **Português (BR)**. Modelo: **Custom**. Hospedagem: serviço HTTPS próprio (**Provision your own**).
3. Selecione **Start from Scratch**, quando solicitado.
4. No painel do plugin no Orbit, clique em **Copiar modelo de voz**. Em **Interaction Model → JSON Editor**, cole o JSON completo ou importe [o interaction model pt-BR](../../apps/api/src/alexa-orbit/alexa/pt-BR.json).
5. Salve e execute **Build Model**. O arquivo tem `invocationName: orbit`.
6. Em **Endpoint**, selecione **HTTPS** e informe o endpoint público correspondente. Selecione o tipo de certificado que corresponde ao certificado HTTPS público instalado. Não use um endpoint HTTP local como endpoint Amazon.
7. Copie o **Skill ID** para a configuração do plugin no Orbit.
8. Em **Test**, habilite testes para **Development**. Não é preciso publicar a skill na loja.
9. Faça uma chamada no simulador, copie seu `userId` para a lista autorizada do plugin, salve e ative o plugin.
10. Teste a fala livre e a consulta de resultado com a sua conta Amazon. Um Echo usado para testes deve estar associado a uma conta autorizada para a skill em desenvolvimento.

Não são necessários Login with Amazon, client secret, OAuth ou Account Linking.

## Transporte de fala

| Intent | Slot | Papel |
| --- | --- | --- |
| `OrbitMessageIntent` | `utterance: AMAZON.SearchQuery` | Entregar a fala ao Orbit para interpretação por IA |
| `OrbitStatusIntent` | Nenhum | Consultar o resultado ou pedir o complemento necessário |

LaunchRequest inicia a coleta da fala. Help explica o uso; Stop e Cancel encerram a sessão. Requests desconhecidos não criam conteúdo. Os antigos handlers comerciais continuam disponíveis somente para compatibilidade; não fazem parte do novo modelo de voz.

O slot SearchQuery é suportado em pt-BR. Amostras de intent precisam de uma expressão de apoio; a coleta direta permite amostra de slot `{utterance}`. A IA normaliza datas e horários a partir da fala e do fuso configurado. Datas inválidas, períodos sem hora exata e ambiguidades de horário são rejeitados antes de criar o compromisso. A duração dos compromissos é de uma hora.

```text
Alexa, abra o Orbit.
Orbit: Orbit ligado. Como posso ajudar?
Usuário: Tenho dentista amanhã.
Orbit: Qual horário?
Usuário: Às quinze horas.
Orbit: Dentista marcado para amanhã às quinze horas. Quer mais alguma coisa?
Usuário: Sim.
Orbit: Pode falar. Como posso ajudar?
Usuário: Preciso comprar café.
Orbit: Café adicionado às compras. Quer mais alguma coisa?
Usuário: Não.
Orbit: Até mais!
```

## Segurança

O endpoint público nunca usa o simulador e nunca aceita JSON apenas por parecer válido. Verifica:

- Corpo original preservado por um parser exclusivo do endpoint, registrado antes do parser JSON global; limite de 64 KB. O teste de regressão compara os bytes recebidos, incluindo espaços e caracteres UTF-8, sem remontar o JSON.
- Skill ID e userId autorizados, sem divergência entre session/context.
- Timestamp válido, com diferença absoluta máxima de 150 segundos, inclusive no futuro.
- `SignatureCertChainUrl` HTTPS no host e caminho oficiais, sem credenciais, query ou fragmento.
- Assinatura `Signature-256` RSA/SHA-256, certificado SAN `echo-api.amazon.com`, validade e cadeia até raízes confiáveis, usando o SDK oficial `ask-sdk-express-adapter@2.14.0`.
- Verificação independente adicional da cadeia pelo OpenSSL nativo, com as raízes do Node, SAN exato e validade do certificado. Ela mitiga a falha de verificação ASN.1 reportada na dependência node-forge do SDK. O OpenSSL está disponível no ambiente DEV validado; ele deve existir também em outros ambientes que ativarem o plugin. Sua ausência rejeita o request, sem afetar o startup do core.

Falha retorna HTTP 400 antes de reservar request ou criar conteúdo. Plugin desativado retorna HTTP 404. Certificados verificados têm cache limitado e expiração. Não existe flag para desligar assinatura no endpoint público.

Documentação oficial consultada:

- [Hospedar uma Custom Skill como serviço HTTPS](https://developer.amazon.com/en-US/docs/alexa/custom-skills/host-a-custom-skill-as-a-web-service.html).
- [Verificador oficial Node](https://github.com/alexa/alexa-skills-kit-sdk-for-nodejs/blob/2.0.x/ask-sdk-express-adapter/lib/verifier/index.ts).
- [Slots, localidades e restrição de SearchQuery](https://developer.amazon.com/en-US/docs/alexa/custom-skills/slot-type-reference.html).
- [Protocolo de requests e responses](https://developer.amazon.com/en-US/docs/alexa/custom-skills/request-and-response-json-reference.html).
- [Advisory de node-forge mitigado pela verificação nativa adicional](https://github.com/advisories/GHSA-86w9-cpqp-85rv).

## Idempotência e falhas

A chave persistida é Skill ID + requestId. Uma reserva é gravada antes de chamar serviços do Orbit. Repetições concluídas recebem a mesma resposta; pedidos simultâneos em andamento não repetem a criação. Reutilizar um requestId com conteúdo diferente é rejeitado.

Como os serviços existentes fazem suas próprias transações, uma interrupção entre a criação e o registro da resposta pode deixar a reserva em `processing`. Ela não é reexecutada automaticamente: o health mostra pedidos sem conclusão confirmada, e a resposta pede conferir o Orbit. Essa escolha evita duplicação diante de resultado incerto. A criação e o agendamento de um card também são duas operações nativas; em falha parcial, confira o card já criado antes de repetir com uma nova fala.

Não são registrados áudio, conteúdo dos slots, respostas completas, IDs pessoais ou segredos nos logs. São registrados eventos técnicos, nomes dos intents, request IDs, classe do erro e etapa/motivo técnico de rejeição (corpo, Skill ID, usuário, timestamp, headers, assinatura ou certificado). Respostas amigáveis não incluem stack traces.

## Teste local explícito

Em DEV, marque **Habilitar simulador local neste ambiente DEV**, salve e ative o plugin. O simulador autenticado chama diretamente os application services e cria conteúdo real nos destinos escolhidos. A rota é:

```text
POST /plugins/alexa-orbit/simulate
```

O simulador exige simultaneamente autenticação Orbit, proprietário correto, plugin ativo, `ORBIT_ENV=development` e opção persistida habilitada. Em produção é sempre recusado. A opção inicia desabilitada. Ela não altera nem contorna o endpoint público.

## Verificações e limites externos

- Testes unitários: protocolo básico, três intents, slots ausentes, erro nativo, destino ausente, request duplicado, plugin desativado, Skill ID/usuário/timestamp inválidos, rejeição pública sem assinatura, SHA-256 com corpo alterado, cadeia autoassinada rejeitada, DST e modelo JSON/dialog.
- Validação em DEV usa serviços reais: três criações, duas chamadas simultâneas com mesmo requestId, timezone, destino arquivado, rejeições públicas sem criação e desativação.
- UI validada em 320, 390 e 1440 px, incluindo toque em celular, destinos persistidos, teste de configuração, limites visíveis e Escape.

O JSON passou pelas verificações locais de estrutura, slots, samples e prompts. A compilação **Build Model** da Amazon, reconhecimento real de voz e request genuinamente assinado dependem da criação/configuração manual da skill e devem ser realizados no Developer Console. Não foram simulados como se tivessem sido aprovados pela Amazon.

## Troubleshooting

- 404 no endpoint: plugin desativado ou endereço/proxy incorreto.
- 400: Skill ID, usuário, timestamp, assinatura ou certificado inválido; confirme a chamada originada pela Amazon e a URL HTTPS publicada.
- Configuração incompleta: escolha destinos válidos, calendário, fuso e usuário autorizado.
- Calendário local: configure quadro e coluna de cards agendados.
- Falha ao criar: verifique permissões/destino; o core continua disponível.
- Pedido em processamento: confira os cards/eventos e os registros técnicos antes de uma nova fala. Não limpe a reserva para repetir sem conferir o conteúdo.

Configuração fica somente neste plugin. Nenhuma integração com listas nativas, sincronização ou controle de dispositivo é instalada.

### A skill repete somente a abertura

O Orbit retorna a frase “Orbit aberto” somente para LaunchRequest. Confira os registros técnicos `alexa_request_verified`: a fala deve chegar como IntentRequest com OrbitMessageIntent e slot utterance. Se chegam apenas LaunchRequest, confira o modelo publicado para o estágio Development e o idioma pt-BR. No painel do plugin, use **Copiar modelo de voz**, cole no JSON Editor da Amazon, execute Save Model e Build Model e aguarde o término. Teste “Alexa, abra o Orbit” e responda “preciso comprar café”. Se ainda falhar, consulte o Intent e os slots mostrados pelo Skill I/O; o backend não recebe o texto original de uma abertura para convertê-lo em tarefa.

## Conversa com IA

1. Configure modelo e esforço globais da IA do Orbit; a integração reutiliza o Codex autenticado, sem exigir chave de API.
2. Copie novamente o modelo de voz e execute Save Model e Build Model na Amazon.
3. Diga “Alexa, abra o Orbit”. A abertura inicia a escuta livre com Dialog.ElicitSlot e updatedIntent.
4. Converse naturalmente. A IA usa o histórico da sessão e devolve uma decisão JSON seguida de `[[ORBIT_SUMMARY]]`, uma linha de até 220 caracteres.
5. O Orbit aguarda até o limite interno de seis segundos, contado na entrada do endpoint público e incluindo verificação de assinatura. Ao concluir a operação, devolve o resumo e pergunta “Quer mais alguma coisa?”. Não anuncia sucesso se o serviço nativo falhar.
6. Se precisar de complemento, pergunta o detalhe e mantém a solicitação no histórico. O próximo turno recebe as falas e respostas anteriores, com seus instantes e ações já confirmadas, para não recriá-las.
7. “Sim” abre a escuta para outro pedido; “não”, “nada mais”, “chega”, “sair”, Stop e Cancel encerram a sessão. Uma frase como “não esquecer de pagar energia” continua sendo um pedido.
8. A conversa geral usa a mesma IA, com resposta curta e sem criar cards. Ela não recebe acesso a arquivos, agenda ou internet nessa interpretação.

### Prazo da Alexa

A Amazon permite aproximadamente oito segundos para a resposta completa da skill. Progressive Responses não ampliam esse limite. O Orbit usa um orçamento de seis segundos para deixar margem ao transporte. Se a IA demorar mais, o pedido fica persistido e a Alexa diz “Ainda estou processando; diga continuar em instantes”. A fala “continuar” obtém o resultado e mantém o contexto. O servidor não consegue fazer a Alexa falar automaticamente uma resposta depois que o prazo dessa chamada terminou; esperar indefinidamente ou prometer essa retomada seria incorreto.

A escuta permanece disponível enquanto a Alexa mantém a sessão aberta e o usuário responde aos prompts; ela não é um microfone permanentemente ligado. A ausência de resposta também pode encerrar a sessão segundo as regras do dispositivo. Uma nova abertura inicia outra conversa.

Referências: [prazo e respostas progressivas](https://developer.amazon.com/en-US/docs/alexa/custom-skills/send-the-user-a-progressive-response.html), [diálogo a partir de LaunchRequest](https://developer.amazon.com/en-US/docs/alexa/custom-skills/dialog-interface-reference.html).

### Persistência e permissões

A fala, o histórico e o resultado dos jobs são criptografados com SecretVault; logs técnicos não contêm a conversa. A configuração mostra os dez jobs mais recentes em “Atualizar pedidos”. A consulta por voz e o reaproveitamento de histórico isolam o usuário Alexa autorizado por hash, proprietário e Skill ID. Só referências de jobs pertencentes ao usuário e recebidas no request assinado são reutilizadas.

Requests repetidos não criam outro job. Claims da fila são atômicos. Jobs interrompidos em interpretação ou gravação não são repetidos automaticamente; confira os registros antes de repetir efeitos sem conclusão confirmada. O histórico é limitado aos últimos turnos para manter o contexto compacto.

Campos desconhecidos, destinos inventados, datas inválidas e horários ambíguos são rejeitados antes de criar conteúdo. Skills dos projetos associados aos quadros de destino são carregadas; configuração e permissões são verificadas novamente antes da gravação. As confirmações da IA só são faladas após sucesso da operação nativa.

## Respostas rápidas

A IA por voz usa esforço **baixo** por padrão, com o mesmo modelo já configurado na conta. “Esforço da IA por voz” fica na configuração deste plugin e permite escolher baixo, médio ou alto. O esforço dos cartões permanece definido pelas suas configurações. Configurações antigas do plugin recebem o padrão baixo automaticamente, sem necessidade de alterar credenciais ou o modelo da Amazon.

A primeira fala inicia o worker imediatamente; ele consome os próximos jobs assim que termina o anterior. O intervalo de dois segundos serve para recuperação de jobs externos ou pendentes, e não acrescenta uma espera entre pedidos locais. Solicitações recebidas enquanto o worker conclui a última consulta também o acordam, evitando perder a notificação.

Consultas independentes de calendário, preferências e projetos são feitas em paralelo; skills continuam sendo carregadas e permissões verificadas antes das operações. A resposta HTTP é acordada por notificação local de conclusão, com uma consulta periódica de 500 ms como recuperação para outras instâncias. Os logs `alexa_ai_job_timing` registram duração de inferência e processamento, ID do job e estado, sem conteúdo da fala nem credenciais. O prazo da Alexa continua se aplicando.
