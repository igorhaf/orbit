# 07D-R2 — Segurança dos papéis PostgreSQL

**R06 BLOQUEADO.** A fronteira SQL depende de ownership e credenciais separados. O repositório não comprova essa separação nos ambientes operacionais. Os testes demonstram os limites do esquema com papéis reais em um cluster descartável.

## Estado e configuração

- `main`, HEAD `d9307b8e6a54316f802acbd7bcb96baa26116f16`. Os quatro locks indicam Core `1.12.5` e 231 mappings. A 209 integra a distribuição e 210/211 continuam somente na fonte.
- DEV, PROD, Safdoulas e Suindá instanciam pools de migração e de aplicação com `DATABASE_URL` em `apps/api/src/migrate.ts` e `apps/api/src/db.ts`. Com a mesma configuração e sem troca de papel externa, os processos usam a mesma identidade. O código não impõe credenciais separadas nem permite determinar os nomes de login, memberships, owner efetivo ou privilégios dos quatro bancos.
- Migrations anteriores, como 138/140/142, reutilizam ownership e grants de tabelas relacionadas para instalações com uma role de runtime separada. A convenção não define uma role editorial e não se aplica à criação das tabelas 209–211. Nenhuma credencial ou configuração operacional foi lida.
- 209–211 não especificam owner, grants, revokes ou `SECURITY DEFINER`. O papel efetivo que cria o objeto assume seu ownership por padrão. No cluster isolado, a role criadora era owner das cinco tabelas. Nenhuma recebeu grants de tabela a PUBLIC. O resultado depende dos privilégios padrão e ACLs do ambiente onde as migrations são executadas.

## Fronteira de escrita

| Objetos | Caminho legítimo e controles SQL | Limite da autorização |
|---|---|---|
| `discovery_journal_captures`, `discovery_journal_entries` | O repository chama `orbit_discovery_capture(jsonb,jsonb,text)`. A função usa privilégios do invocador. Constraints, triggers e locks verificam o hash, a identidade de manifesto/run/card, o turno, o estado do run, a completude e a idempotência. | PUBLIC recebe EXECUTE padrão na fixture. A função não empresta privilégios de leitura ou escrita. Com os grants exigidos pela função, o mesmo papel pode tentar INSERT direto. Os triggers validam os vínculos estruturais. IDs de ator, escopo e origem não autenticam uma pessoa. |
| `discovery_review_decisions` | O repository usa INSERT direto. FK, hashes, chave por descoberta, CAS e transições são validados pelo trigger. O host verifica sessão, ator e escopo, e atribui `reviewerId` à identidade autenticada na fachada. | Uma role com SELECT e INSERT suficientes pode persistir uma decisão estruturalmente válida com uma atribuição declarada. SQL verifica a coerência do registro. O guard transacional do host é a fronteira de autorização humana. |
| `discovery_editorial_policy_versions`, `discovery_editorial_policy_events` | O store usa INSERT direto. A 211 valida a referência completa, o escopo da descoberta, o hash e o estado `unavailable`. Os eventos se limitam a `content_validated` e `revoked`, com sequência protegida pelo lock da versão. | O papel habilitado a inserir candidatas ou eventos pode fornecer a atribuição. Atribuição, validação estrutural e hash não conferem autoridade institucional. DML comum não ativa uma candidata. |

Com triggers ativos, UPDATE, DELETE e TRUNCATE são rejeitados nos cinco objetos. Um leitor com SELECT herdado ainda recebe `42501` para as quatro operações de escrita. A verificação de produção precisa considerar grants diretos, PUBLIC, memberships herdadas, `SET ROLE`, privilégios amplos e ownership. Um owner sem superusuário conseguiu desativar um trigger de imutabilidade na fixture. Owner e administradores com poderes equivalentes estão fora da fronteira oferecida pelos triggers.

As funções usam privilégios do invocador e contêm referências sem qualificação de schema. Não há escalada por definer nessas migrations. A resolução de nomes ainda depende do `search_path` da sessão. Qualquer futura função privilegiada exige schemas confiáveis, referências qualificadas, caminho de busca fixo, owner dedicado e EXECUTE retirado de PUBLIC.

## Alterações e validação

O único código alterado foi `packages/orbit-core/src/execution/discovery-review-repository.spec.ts`. A suíte acrescenta casos com papéis SQL reais para SELECT herdado com DML recusado, ACL de tabela sem PUBLIC, EXECUTE padrão da função do Journal e sua revogação em fixture, validação da função sob EXECUTE explícito, escrita do repository por login restrito e DDL de owner sem superusuário. A role escritora de teste aceita atribuição declarada e continua sujeita a CAS, idempotência e validação do trigger. A fachada mantém a sua regressão de recusa de `reviewerId` vindo do cliente.

As suítes do Review e do Journal executam migrations em PostgreSQL 16 temporário por socket Unix. A cadeia 209 → 210 → 211 passou sobre seus pré-requisitos mínimos. `discovery-review-repository.spec.ts` passou 53/53 com TSX, incluindo os três casos R2, decisão legítima, CAS, rollback, recusas do host, concorrência e candidatas inativas. `node --test tools/orbit/discovery-journal.postgres.test.mjs` passou 13/13, incluindo a função legítima, escopo, idempotência, concorrência e rollback. Total de 66 aprovados e zero falhas. Nenhum teste usou banco operacional.

Não foi criada migration 212. Revogar EXECUTE de PUBLIC em produção sem identificar consumidores e defaults pode interromper o Journal. Revogar DML de uma role genérica não separa a aplicação do owner e compromete os repositories atuais se os dois caminhos compartilham credencial.

## Pré-condições de uma intervenção operacional

1. Em cada ambiente, uma operação autorizada deve confirmar `session_user`, `current_user`, ownership, ACLs de tabelas e funções, ACLs padrão, memberships e privilégios de schemas consultando os catálogos. Registrar apenas papéis e capacidades, sem connection strings.
2. Em um clone descartável, provisionar owner inacessível ao runtime, credencial de migrations e credenciais distintas para o runtime geral e para os serviços com autoridade de escrita. Impedir que a role geral herde ou assuma owner ou writer. Manter credenciais de writer fora do pool geral. Inventariar consumidores legítimos da 209 antes de definir ACLs.
3. Decidir qual componente é a fronteira confiável. Se o SQL direto for proibido inclusive para a role chamada pelo host, substituir INSERT direto por uma interface restrita que não aceite identidade declarada como prova. Se o writer isolado for considerado confiável, limitar o acesso à sua credencial ao componente que autentica e autoriza o ator. Em ambos os casos, testar a separação entre leitura, Journal, Review e governança.
4. Preparar alteração aditiva após confirmar a numeração disponível. Validar grants para a transação inteira, inclusive locks sobre tabelas e linhas, leituras de escopo, auditoria, inserção, rollback e concorrência. Verificar que a role geral não escreve, não altera triggers e não executa entrada privilegiada. Confirmar que a role de leitura preserva consultas legítimas. Tratar a aprovação e ativação de políticas como capacidades separadas.
5. Só promover com revisão de infraestrutura, plano de reversão e evidência dos testes com os papéis previstos para cada runtime. O Discovery Review e a distribuição de 210/211 continuam bloqueados. R02 e R08 permanecem fora desta intervenção.
