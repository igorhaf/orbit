# 07D-R3C-B — Writer participante de plugin_settings

O writer experimental foi implementado no Core canônico e validado em PostgreSQL 16 descartável. O comportamento operacional dos quatro runtimes permanece igual. O Core distribuído segue em 1.12.5 e 231 mappings. As migrations 210, 211 e 212 estão somente na fonte. O snapshot R3B segue parcial e não verificável.

## Caminho operacional inspecionado

`setPluginEnabled` fica em `apps/api/src/main.ts` nos quatro runtimes. DEV, PROD e Safdoulas têm a mesma implementação. Suindá acrescenta uma recusa antes do SQL ao habilitar módulo desativado pelo perfil de produto.

1. O endpoint identifica o usuário, confirma instalação e definição no registry e valida o booleano. Suindá aplica também a regra de perfil.
2. Para desativar `board-view` ou `structured-view`, o endpoint reserva um cliente do pool e abre `BEGIN`. Depois adquire `pg_advisory_xact_lock(hashtextextended('orbit.required-board-view',0))`. Lê as duas configurações na mesma conexão e verifica se pelo menos uma fica ativa com `hasBoardViewAfterChange`. A ausência de uma linha representa habilitação por padrão.
3. O endpoint faz o upsert por `plugin_id`, com `enabled=EXCLUDED.enabled` e `updated_at=now()`. A transação explícita confirma com `COMMIT`, tenta `ROLLBACK` em erro e libera a conexão no `finally`.
4. Para habilitação ou outros plugins, o endpoint faz o mesmo upsert via `Db.query`, em uma única instrução com confirmação implícita e sem o advisory lock de modos de quadro.
5. Depois da escrita no banco, chama `PluginRegistry.setEnabled` e `service.pluginsChanged`. A chamada posterior ao registry ou ao evento pode falhar com a escrita SQL já confirmada.

## Adapter e ordem dos locks

- `packages/orbit-core/src/execution/editorial-plugin-settings-writer.ts` adiciona `writeEditorialPluginSetting`. É uma função interna para chamadores confiáveis. O endpoint futuro continua responsável pelos checks de usuário, definição, instalação e perfil de produto.
- O adapter reutiliza a tabela de 024, o upsert de produção e a regra canônica `hasBoardViewAfterChange`. O teste executa o SQL da migration 024 de DEV para montar a fixture. O adapter preserva os erros tipados da geração e permite distinguir a recusa do último modo de quadro via `RequiredBoardViewError`.
- Ordem experimental: `BEGIN` do repository → linha da geração em `FOR UPDATE` e validação da expectativa → advisory lock para desativação de modo obrigatório → leitura dos modos de quadro → upsert em `plugin_settings` → incremento da geração → `COMMIT`. O upsert adquire seus próprios locks de tabela e linha ou índice conforme exista conflito. A segunda etapa mantém sua proteção durante todas as posteriores.
- O teste mostra uma transação legada com advisory lock bloqueando o writer experimental. Enquanto ele espera, um leitor aguarda sua linha da geração e o plugin de destino ainda não foi escrito. O writer legado consegue fazer seu DML e confirmar porque não solicita a linha da geração. O adapter prossegue depois. Isso comprova a ordem usada na fixture e a convivência com o caminho atual para esse caso.
- Os writers participantes futuros precisam da ordem geração → advisory → DML. Chamar o adapter de dentro da transação legada que já detém o advisory pode inverter a ordem ou bloquear na própria conexão. A adaptação do endpoint deve transferir a transação inteira ao repository e preservar a checagem do último modo ativo.

## Validação

O spec `packages/orbit-core/src/execution/editorial-authorization-generation.postgres.spec.ts` recebeu os casos R3C-B, aproveitando o cluster descartável de R3C-A. A seleção executada teve **14 casos aprovados** (sete R3C-A e sete R3C-B) e dois testes contêiner, sem falhas ou skips. TypeScript estrito dirigido passou para o spec e suas dependências.

| Caso R3C-B | Resultado |
|---|---|
| Pin, upsert legítimo e geração obsoleta | O writer espera pelo pin antes do DML, avança após COMMIT e recusa uma operação com referência antiga. O registry de fixture continua com o estado anterior. |
| Falha após o DML | Trigger de fixture confirmou que o upsert ocorreu e rejeitou o incremento. O rollback preservou a configuração e a revisão anteriores. |
| Visibilidade antes do COMMIT | Uma sessão independente viu a revisão antiga e a ausência da nova configuração enquanto ambas as escritas aguardavam confirmação. Depois viu os dois valores novos. |
| Ordem geração/advisory/DML | `pg_blocking_pids` identificou as duas esperas sobre conexões concretas. O writer legado confirmou, a proteção foi liberada e a escrita participante avançou. |
| Dois writers e último modo ativo | Com a mesma expectativa, apenas um avançou. O outro recebeu conflito. Com a revisão atualizada, a tentativa de desligar o último modo foi recusada sem avanço. |
| Writer fora do protocolo | DML direto em `plugin_settings` confirmou durante o pin e manteve a revisão anterior. |
| Confirmação incerta | A fixture descartou a resposta de um COMMIT real. O repository reportou incerteza e descartou a conexão sem repetir. Uma conexão nova observou configuração e revisão. |

## Limites e próxima tarefa

A confirmação SQL não sincroniza o PluginRegistry ou outros processos. Uma atualização de memória ausente, falha ou fora de ordem mantém a instância sem prova de que sua configuração é atual. A integração futura precisa fechar a disponibilidade editorial nesse caso e só restabelecê-la após reconciliação com o estado efetivo. Em COMMIT incerto, reobservar banco e configuração antes de decidir o próximo passo. O número da geração não atribui a escrita a uma tentativa específica.

`setPluginEnabled` dos quatro runtimes, migrations e SQL administrativo de `plugin_settings` e `plugin_installations` ainda não participam. Também ficam fora do protocolo mudanças locais de callbacks, registry e definição de software. A geração continua `unavailable` para autorização. R02, R06 e R08 seguem abertos. Nenhuma migration ou projeção foi alterada, e o host editorial permanece desativado.

A próxima tarefa mínima é preparar uma adaptação isolada do caminho de DEV com a transação pertencendo ao repository e com a ordem de locks validada em configuração mista. Validar primeiro papéis, rollout e escritores antigos. Injetar falha após COMMIT e comprovar que a configuração local obsoleta é reconhecida antes de propor promoção a qualquer runtime operacional.
