# Comunicação bidirecional Orbit ↔ Codex

## Canal implementado

O Orbit executa a CLI do Codex como processo local. No fluxo de prompt, carrega dados do card/projeto, compõe uma instrução textual, envia `orbitArchitecturePrompt` junto ao prompt por stdin, e recebe JSONL de progresso mais arquivo de última mensagem (`forge/app/apps/api/src/plugins/ai/codex-provider.ts:118-130`). O comando pode iniciar ou retomar sessão pelo ID persistido; `thread.started` atualiza o ID no run (`:172-184`).

O parser reconhece mensagens/fragmentos do agente, comandos, alterações de arquivo, reasoning, turnos e erros (`codex-provider.ts:72-94`). Os eventos normalizados atualizam progresso/atividades e conjunto de arquivos; saída final, session ID, file changes e activities retornam ao serviço (`:186-216,227-233`). O serviço persiste esses dados e emite `prompt:progress` para a sala do quadro (`prompt-sessions.ts:520-527,538-545,564-568`; `orbit-events.ts:17-19`). A interface subscreve eventos e faz polling por card/run (`apps/web/components/prompt-execution.tsx:89-120`).

## Entrada/contexto

O prompt pode incluir descrição do card, checklist, comentários, contexto de cards relacionados, skills/instruções, escopo de escrita, verificações e anexos (`prompt-sessions.ts:426-471`). Execução genérica tem outro builder, com arquitetura Orbit, snapshot do card/configuração, recursos, hashes e escopo (`execution/context-builder.ts:11-51`). Esses pipelines são separados; não foi encontrado contrato de compilação/versionamento único entre ambos.

## Retorno humano

Há modo de pergunta em que marcador do output leva o run para `waiting_answer`; rota valida status/autor/tamanho e retoma execução com a resposta (`prompt-question.ts:4-15`; `prompt-sessions.ts:538-546` e endpoint `:397-405`). É um ciclo de pergunta/resposta limitado por convenção de texto e REST. Comprova input humano posterior, não chamada genérica de ferramentas Orbit pelo Codex.

## Sessão e persistência

O banco armazena prompt, sessão, output, resumo, atividades, arquivos, sugestões de commit e status (`sql/schema.sql:426-450`). Não foi encontrado armazenamento de transcript tipado completo nem invalidação de sessão por revisão de card ou SHA do projeto. Sessão ausente pode iniciar nova conversa (`codex-provider.ts:234-239`). Sugestões de commit são texto parseado; commit exige ação explícita posterior (`prompt-result.ts:1-19`; `git.plugin.ts:189-199`).

## Contratos e fronteiras

| Capacidade | Estado observado | Evidência/limite |
|---|---|---|
| Orbit → Codex: instrução e contexto | Implementado como prompt textual | `codex-provider.ts:118-130`; contexto compilado em `prompt-sessions.ts:426-471` |
| Eventos Codex → Orbit | Parcialmente estruturados e normalizados | Parser JSONL `codex-provider.ts:72-94,172-216` |
| Resultado persistente | Implementado para campos selecionados | `schema.sql:426-450` |
| Pergunta → resposta humana → retomada | Implementado em fluxo restrito | `prompt-question.ts:4-15`; `prompt-sessions.ts:538-546` |
| Codex → chamada arbitrária de ferramenta/consulta Orbit | Não encontrado | Executor genérico configura MCP vazio e ignora configuração do usuário: `execution/codex-executor.ts:26-34` |
| Esquema de saída de resultado rígido | Parcial | Marcadores de texto parseados em `prompt-result.ts:1-19` |
| Canal genérico de conflito, pedido de contexto, decisão/ação | Não encontrado | Eventos atuais cobrem progresso, pergunta humana e erro; não RPC tipado |

## Permitido pelas interfaces versus implementado

O processo, callbacks de progresso, session ID, REST e Socket.IO fornecem pontos de extensão técnica. Isso permite imaginar novas consultas/ações, mas não demonstra um protocolo implementado. O código examinado não comprova que Codex possa consultar Orbit por demanda, receber resposta estruturada de ferramentas, negociar conflitos ou gravar descobertas como conhecimento governado.

## Testes necessários

Testar parsing de eventos parciais/malformados, persistência do session ID sob falha, retomar pergunta após restart, cancelamento em cada status, e coerência entre execução genérica e prompt. Para qualquer futura integração de ferramentas, exigir contratos de autorização, escopo, idempotência, auditoria e respostas tipadas; esta sondagem não propõe nem implementa esse protocolo.
