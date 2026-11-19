# 07D-R3C-C — Orquestração experimental do DEV

A simulação do fluxo de DEV foi implementada e exercitada em PostgreSQL 16 descartável com o PluginRegistry real de DEV. O Core publicado permanece em 1.12.5 e 231 mappings. O endpoint operacional, o readiness e a autorização editorial permanecem fora desta integração.

## Arquivos

- `packages/orbit-core/src/execution/editorial-plugin-settings-orchestration.ts` reúne a escrita experimental, os efeitos locais após COMMIT e a verificação.
- `packages/orbit-core/src/execution/editorial-authorization-generation.ts` passa a expor confirmação de rollback nos erros tipados, preservando os códigos existentes. O cliente é descartado quando a confirmação falta.
- `packages/orbit-core/src/execution/editorial-authorization-generation.postgres.spec.ts` acrescenta fixtures de orquestração e falha.
- Este relatório registra a evidência e as condições de integração.

## Paridade com DEV

O endpoint `PATCH /plugins/:id` depende do guard existente e da permissão `plugins.manage`. `setPluginEnabled` obtém o usuário pelo serviço, verifica instalação e definição e exige um booleano. A orquestração experimental recebe argumentos de chamador confiável, sem identidade ou credencial declarada pelo solicitante. Valida localmente plugin conhecido, instalado e valor booleano. O chamador futuro continua responsável por acionar as verificações reais de autenticação e autorização.

O writer R3C-B mantém o upsert por `plugin_id`, a regra do último modo ativo entre `board-view` e `structured-view` e o padrão habilitado quando a linha não existe. O wrapper de geração possui a transação inteira. A linha de geração é presa para validar a expectativa. Quando necessário, o writer adquire o advisory lock de modos de quadro em seguida, lê a configuração e faz o upsert. O wrapper avança a geração e confirma o COMMIT. A orquestração não abre transação externa nem replica o upsert.

Após a confirmação, a orquestração chama `PluginRegistry.setEnabled` e tenta `pluginsChanged(id)` uma vez. No endpoint atual, esse método delega ao evento `plugins:changed` com identificador e timestamp. O resultado do emissor não comprova entrega aos consumidores. A verificação abre uma nova transação com pin na geração confirmada e compara o valor SQL do plugin com o solicitado e o configurado no catálogo local. A habilitação efetiva vem do registry e pode ser falsa mesmo com configuração verdadeira, por exemplo, quando uma dependência está desativada.

## Estados do contrato

| Status | Condição | Estado local retornado |
|---|---|---|
| `committed_reconciled` | COMMIT confirmado, atualização local e chamada de notificação bem-sucedidas e observação da configuração coerente. | `synchronized`, restrito ao plugin observado, com geração e habilitação efetiva. |
| `committed_local_stale` | COMMIT confirmado, com falha na atualização, notificação ou verificação. | `stale`, com a geração confirmada da escrita e o motivo. Uma falha de notificação pode deixar o valor local correto. |
| `commit_uncertain` | A confirmação do COMMIT da escrita não foi obtida. | `unknown`. Não há atualização de memória, notificação ou retry automático. |
| `rejected` | Plugin/valor inválido, último modo obrigatório ou referência esperada recusada. | `unknown` quanto à sincronização da instância. A tentativa não aplica efeitos locais. |
| `failed_rolled_back` | Falha de operação com resposta de ROLLBACK confirmada pelo driver. | `unknown` quanto à configuração local, sem efeitos locais da tentativa. |
| `failed_unconfirmed` | Falha de operação sem confirmação de rollback, ou indisponibilidade antes de iniciar. | `unknown`, sem inferência de rollback confirmado ou replay. |

O contrato também reserva `reconciling` para a futura integração registrar recuperação em andamento. Os estados tratam apenas da configuração observada do plugin. Uma geração igual é insuficiente para declarar um processo sincronizado. O snapshot R3B segue `partial/unverifiable` e todos os resultados carregam `authorizationState: unavailable`. Nenhum desses estados é ligado ao readiness operacional.

## Validação dirigida

O spec da geração executou a 024 para `plugin_settings` e a 212 para geração somente no cluster PostgreSQL 16 descartável por socket Unix. O resultado final foi **23 casos aprovados e três testes contêiner**, sem falhas ou skips. TypeScript estrito dirigido também passou.

- Os nove casos novos comprovaram sucesso com dependência desabilitada, exceção do registry, falha de notificação, rollback confirmado, confirmação de rollback ausente, COMMIT incerto, concorrência de CAS, divergência legada e preservação da regra dos modos obrigatórios.
- No caso concorrente, uma barreira e `pg_blocking_pids` mostraram os dois writers esperando. Só um usou a expectativa e chamou a notificação. O segundo foi recusado antes de efeitos locais.
- Uma fixture perdeu a resposta após um COMMIT real. A tentativa não repetiu a escrita nem alterou a memória. Uma conexão independente observou a configuração e a geração persistidas. A reobservação não prova autoria da mudança.
- A fixture legada mudou o valor do plugin sem avançar a geração. A leitura comparou estado efetivo do banco e do catálogo local e retornou divergência. Uma escrita de outro plugin ou após o ponto observado ainda pode escapar dessa verificação.

## Versões mistas e próximo passo

O endpoint anterior continua gravando `plugin_settings` sem passar pelo repository de geração. Migrations, SQL administrativo, `plugin_installations` e mutações locais também permanecem fora do protocolo. Gravações legadas podem ocorrer mesmo durante um pin. Entre processos, uma escrita mais nova pode ser confirmada antes do fim dos efeitos locais de uma anterior. O pin pós-COMMIT ajuda a detectar divergência no ponto de observação e não ordena entregas de eventos nem protege a janela posterior.

Antes de integrar o endpoint, inventariar todos os writers e garantir que a versão antiga não possa gravar no modo participante. Preservar a ordem geração → advisory → DML, validar os papéis e conexões previstos no R06 e impedir acesso legado ou direto antes de confiar na geração. Para rollout e rollback de versão, manter a autorização editorial indisponível durante a transição e reconciliar a configuração a partir do banco antes de voltar a aceitar uma instância. A recuperação após crash deve remontar ou verificar o estado local e tratar entregas pendentes pelo contrato futuro de eventos, sem repetir o UPSERT nem presumir entrega única.

A próxima tarefa mínima é especificar e testar em fixture a recuperação de estado local após crash ou notificação fora de ordem, com uma identidade de configuração verificável e estados de reconciliação observáveis. A integração depende ainda de participação de todos os writers, coordenação entre instâncias, fronteira R06, providers homologados e fontes autorizadas. R02, R06 e R08 continuam abertos. O Discovery Review permanece desativado. As migrations 209–212, os 13 locks SHARE, os endpoints e as projeções foram preservados.
