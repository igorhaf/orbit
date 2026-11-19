# 07D-R5C-A — Isolamento PostgreSQL DEV

A transição foi implementada e aprovada na fixture de PostgreSQL 16.15. **R06 continua aberto** até comprovação com os logins e a infraestrutura reais do DEV. R02 e R08 permanecem abertos.

## Base e fronteira proposta

A R5B-AUTO2 comprovou que `orbit_dev_app` é owner de `plugin_settings` e `plugin_installations` em `orbit_native_dev`, pode escrever nas duas tabelas e tem `CREATE` em `public`. A migration 212 não constava do ledger. A API ainda tem o writer direto e usa a mesma variável `DATABASE_URL` que o migrador. Core 1.12.5 com 231 mappings é a referência registrada no preflight.

| Papel | Acesso proposto |
|---|---|
| Owner/migrador | Ownership administrativo do banco, controle de `public` e do ledger, ownership das tabelas protegidas e da função de trigger. Opera DDL, migrations e seed. |
| Runtime geral | SELECT em settings e instalações. Preserva grants ordinários específicos de outros objetos. Sem ownership, DML na fronteira protegida ou acesso ao login privado. |
| Writer privado | SELECT/INSERT nas colunas `plugin_id` e `enabled` de settings, UPDATE em `enabled` e `updated_at`. SELECT da geração e UPDATE só de `revision`. |
| Leitor de diagnóstico | SELECT em settings, instalações e geração. A fixture e os scripts parametrizam esse quarto login. |

A preparação exige banco, schema e ledger sob controle administrativo antes da transferência das tabelas. Ownership adicional do runtime no banco interrompe a execução e exige um plano por objeto. As checagens recusam memberships, permissões inesperadas nos objetos protegidos, criação de objetos pelo runtime e caminhos de elevação via rotinas de usuário acessíveis com `SECURITY DEFINER`. Os logins restritos recebem caminho padrão `pg_catalog, public` por banco. A credencial do writer ainda consegue escrever diretamente nas colunas concedidas. O incremento é garantido pelo uso do repositório participante, portanto a credencial exige confinamento no host.

## Artefatos e resultados

Os artefatos estão em `tools/orbit/dev-db-cutover/`, marcados para uso sob aprovação operacional. `preflight.sql` confere alvo e base, `prepare.sql` faz a transição atômica, `validate.sql` confere o resultado e `contingency.sql` verifica a barreira durante a suspensão do toggle. `README.md` registra precondições e sequência. A preparação executa o SQL fonte de 212 e registra nome completo e SHA-256 no formato do ledger Orbit.

Comando executado na raiz do monorepo:

```sh
./dev/app/node_modules/.bin/tsx --tsconfig dev/app/apps/api/tsconfig.json --test tools/orbit/dev-db-cutover/transition.postgres.spec.ts
```

**6 testes aprovados, incluindo o teste pai.** O harness iniciou somente um cluster temporário acessível por socket Unix privado. Aplicou 024 e 142 com ownership legado, comprovou a escrita antiga e ausência de 212, e executou a mesma sequência SQL entregue. A preparação recusou alvo incorreto, herança/SET ROLE, ownership adicional e ACL inesperada. A falha na validação interna desfez a transferência e a migration. Preflight e validação foram repetidos no estado apropriado.

Sessões distintas confirmaram a recusa do UPSERT legado, de SET ROLE, de DDL, de mudança de trigger e de delegação de ACL, com leituras de configuração e escrita ordinária representativa disponíveis. O writer R3C-B real foi exercitado com duas conexões e a mesma revisão. Houve um avanço, uma recusa por CAS e recusa ao desativar a última vista de quadro. Uma constraint provocou falha após o UPSERT e comprovou rollback dos dados e da revisão. A perda simulada da resposta de COMMIT provocou recuperação por leitura nova, com um único COMMIT e estado de autorização `unavailable`.

O owner realizou DDL e um dump/restore administrativo em clone vazio com `--no-owner` e `--no-privileges`. Os objetos ficaram sob o papel de restore e os grants da aplicação precisariam ser reaplicados. O teste cobre a fronteira SQL do restore, sem executar a CLI Orbit, criptografia ou backup externo.

## Limites e homologação

O bootstrap precisa continuar lendo settings e instalações. O toggle legado sofrerá recusa enquanto o writer participante não estiver montado. Migrations, schema, compatibilidade pré-022 e seed executam DDL ou DML administrativo. Grants de tabelas ordinárias, sequências, extensões, outros writers, dependências de tabelas temporárias e rotinas com permissões elevadas precisam ser conferidos em clone representativo. A fixture preservou leituras de configuração e uma escrita de auditoria representativa. Ela não exercitou o schema completo, bootstrap HTTP, seed, o serviço de restore Orbit ou a entrega de notificações entre hosts.

Antes de homologar, o operador deve conferir destino, ownership completo e ACLs, separar os quatro logins, verificar o backup em clone e impedir reconexões antigas durante a janela. Em falha antes do COMMIT, confirme o estado anterior em nova sessão. Em COMMIT incerto, confira ledger, ownership e ACLs antes de tomar nova ação. Após o corte, uma reversão de binário exige manter a fronteira SQL, suspender o toggle e desconectar o pool privado.

A próxima ação mínima é preparar um clone representativo do DEV e mapear os objetos ainda pertencentes ao runtime e os grants necessários por fluxo. Em seguida, repetir o plano e os testes de aplicação nesse clone antes de pedir aprovação operacional. O banco DEV efetivo, o core publicado e suas projeções ficaram fora das alterações. Discovery Review continua desativado.
