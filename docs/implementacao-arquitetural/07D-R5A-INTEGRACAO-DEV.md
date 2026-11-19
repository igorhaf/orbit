# 07D-R5A — Integração experimental do toggle no DEV

## Entrega

O adaptador do DEV passa pelo `AccessGuard` real e chama a transação R3C pelo pool de configuração. O endpoint `PATCH /plugins/:id` continua no caminho operacional anterior. O novo módulo está fora do build da API e é montado pelo teste descartável.

O baseline é Core 1.12.5 com 231 mappings. As migrations 210–212 continuam na fonte e os 39 resultados da R5-PRE foram reproduzidos no mesmo harness.

| Arquivo | Mudança |
|---|---|
| `dev/app/experimental/plugin-setting-toggle.ts` | Composição interna com `AccessGuard`, `AccessService`, repositório da geração, orquestração R3C-C e recuperação R3C-D. |
| `dev/app/experimental/plugin-setting-toggle.postgres-fixture.ts` | Exercita o adaptador com sessões assinadas, grants reais, dois registries DEV e pools restritos. |
| `packages/orbit-core/src/execution/editorial-authorization-generation.postgres.spec.ts` | Aciona a fixture DEV dentro do banco e dos papéis da R5-PRE. |

## Fronteira de autorização e conexões

O ponto de entrada interno confere método, rota e plugin. O `AccessGuard` autentica o token e resolve o ator pela infraestrutura de acesso existente. O serviço confirma `plugins.manage` pelo próprio `AccessService` antes de entrar na função privada de escrita. O teste usa dois usuários não ROOT, avaliação real de RBAC e auditoria da recusa. A requisição e o contexto Nest são construídos na fixture. O servidor HTTP e o bootstrap completo ficam fora dessa prova.

O pool geral atende às consultas de sessão, RBAC e configuração e permite a auditoria normal. A credencial geral da fixture sofre recusa SQL ao tentar alterar a configuração. O host entrega o pool de configuração diretamente ao adaptador. Apenas o repositório interno usa esse pool, inclusive para a leitura com lock, a escrita e a recuperação. O registry recebe apenas efeitos locais. O adaptador recusa pool ausente ou igual ao pool geral. Essa verificação de objetos não atesta credenciais distintas. Na fixture, a prova vem dos logins e ACLs verificados na R5-PRE.

A configuração aceita booleanos e plugins instalados. R3C-C valida a definição e chama `writeEditorialPluginSetting` com uma referência de geração observada pelo servidor. R3C-B conserva a ordem geração → advisory → DML e a regra do último modo de quadro. A ausência de linha mantém o padrão existente. O PluginRegistry real continua calculando a disponibilidade dos dependentes.

O adaptador preserva `committed_reconciled`, `committed_local_stale`, `commit_uncertain`, `rejected`, `failed_rolled_back` e `failed_unconfirmed`. Uma falha ao observar a geração antes de iniciar a escrita retorna `rejected`. Após COMMIT confirmado, R3C-C atualiza o registry e chama a notificação. Em COMMIT incerto, o host pode chamar a recuperação por leitura, sem repetir UPSERT. As observações se referem ao plugin e à instância. Todos os resultados mantêm a autorização editorial indisponível.

## Validação

**43/43 resultados aprovados**, incluindo os contêineres do runner. O harness reutilizou PostgreSQL 16 descartável, migrations 024, 142 e 212 e as ACLs da R5-PRE. O TypeScript estrito dirigido também passou.

| Cenário | Evidência |
|---|---|
| Gerente, leitor e sessões inválidas | JWT assinado e papel com `plugins.manage` permitem toggle. Leitor recebe 403 auditado mesmo com ator pré preenchido. Assinatura inválida e versão de sessão incorreta recebem 401. |
| Pool legado e efeito após COMMIT | UPSERT legado recebe 42501. O adaptador só expõe operações, e a notificação observa SQL e registry locais atualizados. O incremento e a mudança no plugin são observáveis juntos. |
| Concorrência e quadro obrigatório | Dois hosts observaram a mesma geração em conexões independentes. Apenas um confirmou. O outro recebeu conflito CAS e a desativação posterior do último quadro foi recusada. |
| Falhas e recuperação | Falha de notificação retorna estado local obsoleto. A perda simulada da resposta de um COMMIT real retorna estado desconhecido após um único UPSERT. Um registry novo recupera a configuração por leitura. O registry antigo pode continuar obsoleto e nenhum resultado autoriza revisão editorial. |

Executar com a configuração TypeScript da API para carregar os decorators do AccessGuard:

```sh
./dev/app/node_modules/.bin/tsx --tsconfig dev/app/apps/api/tsconfig.json --test packages/orbit-core/src/execution/editorial-authorization-generation.postgres.spec.ts
```

## Pré condições do cutover

R02, R06 e R08 continuam abertos. A avaliação de permissão precede a transação e segue a semântica do toggle atual. A fixture não protege a autorização editorial contra revogação concorrente, não atesta versão do bootstrap e não demonstra entrega distribuída de notificações. Os registries simulam duas instâncias no mesmo processo com conexões independentes. O privilégio privado segue restrito pela composição do host e pelas ACLs verificadas na fixture. O isolamento de credenciais do host real ainda precisa de evidência.

O próximo passo é o operador confirmar logins e ACLs efetivos, bloquear e drenar writers legados, verificar a 212 no banco DEV correto, validar o bootstrap e a identidade da configuração e aprovar um rollback que mantenha o DML legado bloqueado. Depois disso, o patch de montagem pode disponibilizar os módulos R3C por uma referência versionada, mover o adaptador para o build da API, ligar o serviço privado ao ponto de entrada já guardado e mapear os estados de falha para a resposta do toggle. O rollback deve preservar os dados e a geração e suspender a escrita de versões antigas. Discovery Review segue indisponível.
