# 07D-R3C-D — Recuperação local após falhas

## Escopo

Implementada somente a recuperação experimental interna da configuração local de plugins. Não foram criados endpoints, integração de readiness, infraestrutura de eventos, migrations, projeções ou autorização editorial. A autorização continua `unavailable` em todos os resultados.

## Componentes

- `packages/orbit-core/src/execution/editorial-plugin-settings-recovery.ts`: reconciliação local tipada.
- `packages/orbit-core/src/execution/editorial-authorization-generation.ts`: observação transacional da geração e da configuração persistida do plugin, incluindo presença explícita e valor padrão.
- `packages/orbit-core/src/execution/editorial-authorization-generation.postgres.spec.ts`: casos dirigidos de R3C-D e regressões A/B/C.

## Contrato de recuperação

- SQL é a fonte observada; payloads de notificação são ignorados. A chamada relê configuração, presença explícita e geração; não repete UPSERT.
- Plugins desconhecidos, não instalados/ocultos ou com dependências indisponíveis para ativação retornam `unavailable`.
- Divergência local, mudança detectada entre observações ou falha na aplicação local retornam `stale`.
- Fonte indisponível ou leitura posterior inconclusiva retorna `unknown`.
- `reconciled_observed` significa apenas que configuração local e SQL coincidiram na última observação concluída. Não prova estabilidade posterior nem entrega de evento.
- `reconciling` é um estado transitório reservado no tipo; a API interna retorna somente o resultado terminal da Promise e não expõe acompanhamento em andamento.
- O valor padrão é `enabled=true` quando não existe linha explícita; a recuperação não cria registro SQL.
- Mutex em memória serializa chamadas pelo mesmo repositório e plugin dentro do processo. Não coordena processos ou instâncias.

## Cenários exercitados

- Reinício com configuração ausente/default e reconstrução de estado local obsoleto.
- Notificações duplicadas, antigas e fora de ordem, além de evento perdido; a consulta mais recente prevalece.
- COMMIT cuja resposta se perdeu: a recuperação faz nova leitura e não reexecuta a escrita.
- Falha na primeira ou segunda leitura, falha ao atualizar o registry, plugin oculto e dependência desativada.
- Duas recuperações locais sobrepostas para o mesmo plugin.
- Writer legado altera a configuração entre observação e efeito local sem avançar geração; a operação retorna `stale` e não declara reconciliação.
- Regressões existentes cobrem o efeito após COMMIT, falha antes da notificação e falha da notificação na orquestração R3C-C.

## Validação

- `tsx --test packages/orbit-core/src/execution/editorial-authorization-generation.postgres.spec.ts`: **35 testes passaram, 0 falharam**, usando cluster PostgreSQL temporário e descartável.
- TypeScript estrito direcionado aos três arquivos acima: **aprovado**.
- `git diff --check` nos arquivos da etapa: **aprovado**.
- Não foram executadas suítes globais, migrations operacionais, deploy ou reinício.

## Limites e bloqueios

A geração somente detecta writers que participam do protocolo. Um writer legado pode alterar SQL sem mudar a geração; a comparação de configuração detecta algumas mudanças observáveis, mas não elimina corridas depois da última leitura. O mutex não é distribuído. A recuperação não autentica identidade de software, não valida confiança do snapshot R3B e não emite nem confirma notificações. Portanto, nenhuma resposta autoriza decisões editoriais.

Antes de considerar integração operacional, é necessário resolver R06 e inventariar/integrar todos os writers de `plugin_settings`, definir a fonte confiável para configuração/identidade e avaliar os bloqueios R02 e R08. Até lá, manter a recuperação experimental e a autorização indisponível; não há justificativa para avançar à integração operacional.

## Preservação

Branch `main`. Sem commit, push, deploy, restart ou alteração de migrations, mappings, projeções e filas nesta etapa. A árvore já continha alterações extensas de etapas anteriores; foram preservadas e não reconciliadas aqui.
