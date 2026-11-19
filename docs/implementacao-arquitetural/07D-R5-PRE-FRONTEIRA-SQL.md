# 07D-R5-PRE — Fronteira SQL para configuração de plugins

## Resultado

Em PostgreSQL 16 descartável, o writer R3C-B executou pela conexão de configuração com privilégios por coluna. O PostgreSQL recusou o UPSERT legado pela conexão geral. R06 continua aberto nos quatro ambientes.

Em `main`, HEAD `d9307b8`, workspace, pacote e quatro locks declaram Core 1.12.5 com 231 mappings. As migrations 210–212 continuam na fonte canônica. R3C-A/B/C/D permanecem experimentais. R02, R06 e R08 seguem abertos e o Discovery Review continua indisponível.

## Papéis e privilégios da fixture

O harness R3C criou um banco dedicado no mesmo cluster descartável e abriu pools independentes pelo socket Unix privado. Os quatro papéis são logins de teste e cada conexão comprovou `session_user = current_user` para o login esperado. O proprietário aplicou o SQL real de 024, 142 e 212 antes da configuração das ACLs da fixture.

| Papel da fixture | Acesso verificado |
|---|---|
| `r5_owner` | Proprietário do banco e das três tabelas. Executou o DDL das migrations. |
| `r5_app` | `SELECT` em `plugin_settings` e `plugin_installations`. O UPSERT legado, UPDATE, DELETE e TRUNCATE de settings e o avanço da geração foram recusados. |
| `r5_writer` | `SELECT(plugin_id, enabled)`, `INSERT(plugin_id, enabled)` e `UPDATE(enabled, updated_at)` em settings. `SELECT` na geração e `UPDATE(revision)`. Sem escrita em instalações e sem DELETE/TRUNCATE em settings ou na geração. |
| `r5_reader` | `SELECT` nas três tabelas. DML e lock de linha `FOR SHARE` recusados. |

Os três logins de execução têm `CONNECT` e `USAGE` no schema. A fixture retirou de PUBLIC o acesso ao schema alvo, `CONNECT`/`TEMPORARY` no banco e o `EXECUTE` padrão da função de trigger de 212. O teste verificou ausência de ACL de tabela e de EXECUTE do guard para PUBLIC. A aplicação continuou lendo a configuração e o writer continuou sujeito ao trigger.

Os logins de execução não têm memberships, herança de papéis, superusuário, `CREATEROLE`, `CREATEDB`, replicação ou `BYPASSRLS`. `SET ROLE` para o proprietário e, para os logins geral e leitor, para o writer foi recusado. Alteração de tabela, desativação de trigger e troca de `session_replication_role` foram recusadas. O teste checou a ausência de opção de concessão de UPDATE e comparou a ACL antes e depois da tentativa de GRANT feita pela aplicação geral.

## Comportamento transacional comprovado

- O caminho legado sofreu erro PostgreSQL `42501` com o SQL de UPSERT equivalente ao do endpoint. Chamar o repository pela mesma credencial também falhou com rollback confirmado.
- Dois writers com a mesma expectativa foram executados em conexões distintas. O monitor administrativo do harness observou um esperando o advisory lock de quadro e o outro esperando a transação da geração. Antes da liberação, configuração e geração permaneciam na versão anterior.
- Após liberar o advisory, um writer confirmou o UPSERT e a revisão avançou uma vez. O outro retornou conflito CAS. Uma tentativa posterior de desativar o último modo de quadro foi recusada.
- Uma constraint temporária da fixture forçou falha no avanço após o UPSERT. A leitura independente confirmou que configuração e revisão foram preservadas no rollback.
- A 212 continuou rejeitando salto e revisão negativa. O writer não tem UPDATE em `authorization_state`. Os guards originais permaneceram ativos e recusaram alteração de estado e TRUNCATE mesmo na conexão proprietária enquanto habilitados.

## Limites e adaptação mínima para DEV

`observe()`, `observePluginSetting()` e `withPinned()` usam `FOR SHARE`, que exige privilégio UPDATE além de SELECT. O leitor puro pode consultar sem lock. Na integração do toggle, o host pode usar o pool de configuração para ler e fixar a geração no fluxo autorizado, inclusive para reobservar após COMMIT incerto. Uma futura leitura independente que precise preservar o pin terá de ter sua fronteira definida separadamente.

A ACL separa o writer legado do participante. A credencial participante ainda tem DML direto nas colunas concedidas e o guard 212 valida a progressão da revisão. O PostgreSQL não exige que todo DML feito com essa credencial passe pelo repository ou que um avanço venha acompanhado de UPSERT. O host que detém essa credencial precisa ser a fronteira confiável. Se o requisito futuro incluir impedir DML direto também pelo participante, o contrato atual é insuficiente.

Para R5A, manter o pool geral para operações ordinárias e criar, no host, um pool privado para a configuração. Expor somente a operação tipada de toggle a um serviço autorizado. O serviço valida sessão, `plugins.manage`, plugin instalado e seu perfil antes de chamar o writer. A conexão e a referência esperada são escolhidas no servidor. O pool e seus clientes ficam fora do registry, das APIs de plugins e dos parâmetros da requisição. A transação inteira segue geração → advisory → DML. O host atualiza o registry após confirmação e reobserva em conexão nova se o COMMIT for incerto, sem repetir o DML.

Antes de uma integração operacional, o operador precisa comprovar os logins efetivos, ownership, ACLs, privilégios herdados e caminhos de migration/restore no DEV. No corte, drenar transações legadas e comprovar que binários antigos usam um papel geral sem DML nem acesso à credencial participante. Em rollback de versão, manter a restrição e suspender o toggle antigo. Para o teste de toggle são suficientes 024, 212 e 142 quando houver validação do bootstrap. 210/211 são independentes desse fluxo.

## Validação e arquivos

- Spec dirigido `packages/orbit-core/src/execution/editorial-authorization-generation.postgres.spec.ts`, com as regressões R3C no mesmo harness. **39/39 aprovados**, contando os contêineres do runner.
- TypeScript estrito dirigido ao mesmo spec.
- Alterações limitadas ao spec e a este relatório.

**Recomendação para R5A** — implementar e validar o adaptador do toggle em DEV descartável com os dois pools, duas instâncias e o bloqueio do binário antigo. A promoção operacional depende da verificação dos papéis pelo operador. A autorização editorial permanece indisponível.
