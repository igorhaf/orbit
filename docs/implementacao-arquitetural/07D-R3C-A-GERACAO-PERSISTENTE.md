# 07D-R3C-A — Geração persistente de autorização

A fundação transacional foi implementada no Core canônico e validada com conexões independentes em PostgreSQL 16 descartável. O estado da geração permanece indisponível para autorização editorial.

## Baseline e arquivos

A branch `main` estava no HEAD `d9307b8`. O Core publicado permanece em 1.12.5 com 231 mappings em DEV, PROD, Safdoulas e Suindá. A 212 era o próximo número disponível na fonte e nos quatro runtimes.

- `packages/orbit-core/sql/migrations/212_editorial_authorization_generation.sql` cria a linha de coordenação e seu guard.
- `packages/orbit-core/src/execution/editorial-authorization-generation.ts` define referências, erros tipados e operações transacionais.
- `packages/orbit-core/src/execution/editorial-authorization-generation.postgres.spec.ts` testa a migration e o repository contra o PostgreSQL descartável.
- Este relatório registra os limites e a próxima tarefa.

## Identidade e fronteira de confiança

A migration cria uma linha por banco e deixa o **PostgreSQL** gerar um UUID para o domínio. A revisão começa em zero. O teste aplica a mesma migration em dois bancos distintos do cluster e confirma que os domínios divergem. Assim, uma referência observada no banco A não passa como a referência esperada no B. A fronteira depende do pool, da conexão escolhida pelo host e do schema resolvido pelo servidor. Nenhum endpoint fornece referências de cliente.

Um clone ou restore que preserve a tabela também preserva o UUID. Antes de inserir clones isolados no protocolo operacional, será necessário um procedimento explícito de identidade e uma referência confiável no host. A 212 não tenta detectar clones ou estabelecer a identidade da instância de software. A versão declarada no PluginRegistry é metadado e não comprova qual artefato foi carregado. O host futuro precisa associar identidade de build verificável, identificação de runtime e configuração efetiva ao domínio.

A geração persistente é `{domainId, revision}`. A revisão usa a representação decimal de `bigint` para evitar arredondamento em JavaScript. O estado SQL admite apenas `unavailable`. O repository retorna `configurationVerification: 'unknown'`. O digest de R3B continua identificando uma observação local `partial/unverifiable` e não é inferido nem validado por essa revisão.

## Contrato transacional

| Operação | Protocolo |
|---|---|
| `observe()` | Transação READ COMMITTED com `SELECT … FOR SHARE`, retorno da identidade/revisão observadas e encerramento da transação. |
| `withPinned(expected, inspect)` | Obtém SHARE na linha da geração, compara domínio/revisão e mantém o lock enquanto o callback interno usa a conexão. O wrapper só retorna após a confirmação do COMMIT. |
| `advance(expected, mutate)` | Obtém `FOR UPDATE` antes da mutação. Após validar a referência, executa o DML participante pela mesma conexão e atualiza a revisão por CAS na mesma transação. |

Os callbacks são internos e confiáveis. Precisam concluir o trabalho na conexão fornecida e deixar BEGIN, COMMIT e ROLLBACK sob controle do repository. O lock é de linha naquela tabela e permanece até o fim da transação. O trigger exige incremento unitário, impede troca de domínio, DELETE e TRUNCATE comuns. A migration não cria papéis nem retira os poderes de proprietário. Um writer com privilégios próprios pode contornar o protocolo ou alterar uma configuração que não tem ligação com a linha.

Referência malformada, domínio divergente, geração obsoleta, indisponibilidade, falha de operação e resultado de COMMIT incerto têm códigos distintos, sem propagar erros SQL brutos. Falhas anteriores à confirmação do COMMIT tentam rollback. Falha de rollback descarta a conexão. Falha ao confirmar COMMIT descarta a conexão e retorna `editorial_generation_commit_uncertain`, sem retry automático. O chamador deve reobservar em transação nova e reconciliar o estado persistido. Um avanço observado por si só não atribui qual writer o produziu.

## Concorrência demonstrada

Foram aprovados **7 subtestes e 1 teste contêiner**, sem falhas. O harness inicia PostgreSQL 16 com socket Unix privado, verifica o diretório antes do DDL e encerra o cluster temporário ao final. O TypeScript estrito dirigido passou para o contrato e o spec.

1. A 212 inicia em revisão zero e estado indisponível. Dois bancos recém-inicializados produzem domínios distintos. SQL comum rejeita ativação, salto de revisão, DELETE e TRUNCATE.
2. Uma barreira pausa o leitor após a comparação. O teste usa `pg_blocking_pids` para comprovar que o writer está esperando no backend do leitor. O callback de alteração ainda não começou. Depois do COMMIT do leitor, a configuração e a revisão avançam juntas.
3. Dois writers com a mesma expectativa executam uma única alteração. O perdedor recebe conflito antes do DML. Uma instância com referência anterior também é recusada.
4. Uma falha depois do DML deixa a configuração e a revisão anteriores intactas.
5. A terminação real do backend antes do COMMIT libera o lock e desfaz a alteração.
6. A fixture faz um COMMIT real e simula a perda da resposta. O repository descarta a conexão, retorna incerteza e não repete o DML. Outra conexão reobserva a revisão atual e a tentativa com expectativa antiga conflita.
7. O writer sem participação consegue alterar a configuração durante o pin e não incrementa a revisão. A observação continua com verificação desconhecida e autorização indisponível.

## Writers pendentes e próxima tarefa

`setPluginEnabled` em `main.ts` nos quatro produtos grava `plugin_settings` e atualiza o registry em memória. Os modos obrigatórios de quadro têm um advisory lock próprio. O bootstrap lê `plugin_settings` e `plugin_installations`. As migrations de instalação e defaults também gravam nessas tabelas, incluindo a retirada do Vault no Safdoulas. Esses caminhos, bem como SQL administrativo, ainda não participam da geração.

O pin PostgreSQL não cobre `Map.set` de callbacks, troca de closures ou `setAuthorizer`, referências expostas, estado em memória após COMMIT ou combinações divergentes de código/configuração. Uma instância atrás da revisão conhecida recebe conflito. Uma instância com comportamento divergente e número igual continua sem prova de configuração. Nenhum dos dois casos ganha autorização.

A próxima tarefa mínima é adaptar em fixture **um** writer de `plugin_settings` que reutilize a conexão do repository, com ordem de aquisição demonstrada em relação ao advisory lock de modos de quadro. Em seguida, confirmar o inventário dos demais writers, a fronteira de papéis R06 e a estratégia de instalação/identidade por runtime antes de qualquer integração efetiva. A 212 permanece só na fonte. O host editorial, os 13 locks SHARE, os providers dos quatro produtos, o snapshot R3B e os bloqueios R02, R06 e R08 foram preservados. A revisão editorial segue desativada.
