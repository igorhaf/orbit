# 07D-R4 — Inventário de writers e plano de integração

## Baseline confirmado

- Branch `main`, HEAD `d9307b8`; havia 475 entradas no `git status` antes deste relatório. Nenhuma foi limpa ou modificada por esta inspeção.
- Core `1.12.5`, 231 mappings na declaração do workspace, pacote e locks de DEV, PROD, Safdoulas e Suindá.
- Migrations 210–212 existem em `packages/orbit-core/sql/migrations`, mas não estão nas projeções dos quatro runtimes. A 209 permanece projetada.
- O writer/orquestração/recuperação R3C estão na fonte canônica e foram testados em fixtures; não estão publicados nos runtimes nem ligados aos endpoints operacionais.
- R02, R06 e R08 seguem abertos. Discovery Review, MCP e Codex nativo continuam indisponíveis. Nenhum teste ou acesso a banco operacional foi feito nesta etapa.

## Inventário de writers

| Classe e runtime | Arquivo/método; tabela/operação | Transação e locks atuais | Papel, memória, geração e risco | Menor alteração necessária |
|---|---|---|---|---|
| Operacional — DEV, PROD, Safdoulas e Suindá | `app/apps/api/src/main.ts::setPluginEnabled`; `plugin_settings` via `INSERT … ON CONFLICT DO UPDATE`. Não há endpoint operacional de instalação que escreva `plugin_installations`. | Caminho comum: statement autocommit. Ao desativar `board-view`/`structured-view`: `BEGIN` → advisory transacional `orbit.required-board-view` → `SELECT` das duas configurações → validação → upsert → `COMMIT`. Sem lock da geração. | Exige acesso da aplicação a `plugin_settings` (SELECT, INSERT, UPDATE). Após SQL confirmado, chama `PluginRegistry.setEnabled` e `pluginsChanged`; falha/resultado de COMMIT incerto pode deixar SQL e memória divergentes. Nenhuma participação na 212. | Transferir a transação inteira ao writer participante, geração → advisory → DML; manter checks de identidade, `plugins.manage`, instalação, definição e último quadro. Adicionar reconciliação e falha fechada. Suindá conserva sua validação do perfil de produto. |
| Bootstrap — os quatro | `main.ts`, factory de `PluginRegistry`; SELECT em `plugin_settings` e `plugin_installations`, depois `setEnabled`/`setInstalled` em memória. | Leituras por `Db.query`, sem transação compartilhada com a geração; defaults de registry também são aplicados localmente. | Precisa de SELECT. Não escreve as tabelas e não avança geração. Catálogos e plugins registrados variam por produto; estado pode divergir entre processos. | Capturar configuração e geração no bootstrap, materializar snapshot local selado e manter disponibilidade fechada até reconciliar. Não tratar setters locais como writers SQL. |
| Migration/instalação — base dos quatro | `sql/migrations`: 022 remove `automations`; 062 remove `alexa`; 066 habilita `workspaces`; 132 habilita `collections`/`process-board`; 134 habilita `project-boards`; 136 habilita `record-cards`; 142 cria `plugin_installations` e habilita Vault. Alteram `plugin_settings`; 142 também cria/granta `plugin_installations`. | `migrate.ts` usa uma conexão e `migrateVersions` executa as migrations versionadas sob transação e advisory global `72641025`. Não participam da 212. | Papel de migração precisa de DDL e de proprietário/grants conforme migration. A 142 faz `plugin_installations` herdar owner de `plugin_settings` e copia grants SELECT/INSERT/UPDATE/DELETE dos grantees não-PUBLIC. Isso pode conceder mais do que o runtime necessita. | Separar credencial de migration da credencial da aplicação; revisar e limitar grants da tabela de instalação; incluir migrations de configuração no inventário/cutover de writers. |
| Migration específica — Safdoulas | `135_safdoulas_disable_project_board_creation.sql` atualiza `plugin_settings`; `143_safdoulas_remove_vault.sql` atualiza `plugin_installations` e `plugin_settings`. | Mesmo executor transacional de migration. Nenhuma geração. | Mudança intencional do produto. Não se deve remover ou sobrescrever ao sincronizar os outros ambientes. | Manter migrações de domínio isoladas e fazê-las participar do protocolo se puderem ocorrer enquanto a aplicação editorial estiver ativa. |
| Seed — quatro | `plugins/collections/collections.seed.ts` apenas consulta `plugin_settings`; nesta busca não apareceu DML de seed para as duas tabelas. | Leitura fora da geração. | Não é writer destas tabelas. | Sem mudança de protocolo; reclassificar se o seed futuro passar a escrever. |
| Restauração — quatro | `database-backup.ts::restoreDatabaseBackup`, chamado pelo endpoint/script de restore; `pg_restore` restaura o banco inteiro, incluindo as duas tabelas quando presentes. Destino exige banco vazio e URL separada `ORBIT_RESTORE_DATABASE_URL`. | `pg_restore --single-transaction`; target é diferente da origem. Não é atualização seletiva nem participante da geração. | Credencial de restauração precisa criar objetos. `--no-owner --no-privileges` faz os objetos restaurados pertencerem ao usuário que executa o restore. Um dump futuro contendo 212 preserva o `domain_id`; clone não ganha identidade nova automaticamente. | Procedimento de recuperação deve revalidar/rotacionar identidade de domínio antes de conectar clone como runtime independente; manter aplicação fora do target até validação. |
| Potenciais/históricos | SQL administrativo manual e ferramentas externas de DB não têm inventário completo verificável no repositório. Specs/fixtures executam DML direto, mas não são writers de produção. | Pode ignorar qualquer lock da aplicação. | Privilégios reais e uso operacional são desconhecidos; não consultados nem inferidos de segredos. | Operador deve inventariar automações e restringir papéis antes de confiar na geração. |

## Diferenças e versões mistas

O endpoint é essencialmente igual nos quatro ambientes. DEV/PROD/Safdoulas validam sessão/usuário, `plugins.manage` pelo mapeamento de rota, instalação e definição; Suindá também recusa habilitar módulos proibidos pelo perfil. Apenas Safdoulas tem as migrations específicas acima. Cada produto mantém banco e catálogo próprios.

`Db` e `migrate.ts` criam pools a partir de `process.env.DATABASE_URL`; o código não demonstra identidades distintas entre runtime e migration. Não li `.env` nem segredos, portanto os papéis efetivos não podem ser confirmados. O restore usa `ORBIT_RESTORE_DATABASE_URL`. Os quatro processos antigos podem continuar gravando direto sem avançar a revisão. Um runtime novo que exija a 212 falha se a migration estiver ausente; com versão mista, writers antigos podem alterar SQL sem gerar conflito. `pluginsChanged` não comprova atualização dos demais processos.

## Fronteira R06 — validações para operador autorizado

Sem expor credenciais, conferir separadamente em cada banco: `current_user`/`session_user` do runtime, migration e restore; dono de `plugin_settings`, `plugin_installations` e `editorial_authorization_generation`; grants efetivos e memberships; privilégios superuser/`BYPASSRLS` e capacidade de assumir o papel proprietário; privilégios de schema e execução de funções. Confirmar que o runtime não é proprietário nem consegue contornar a fronteira; que migrations têm DDL/ownership necessários; e que o caminho de escrita autorizado só recebe o menor privilégio comprovado. Verificar especialmente os grants herdados pela 142.

Enquanto runtime e migrations puderem usar a mesma identidade proprietária, **R06 fica bloqueado**. A inspeção não criou nomes de papéis nem credenciais. Operações administrativas e restore continuam fronteiras privilegiadas que precisam de procedimento próprio.

## Componentes experimentais e menor integração

`editorial-authorization-generation.ts` (212) oferece `observe`, `withPinned` e `advance`; o writer experimental cobre `plugin_settings`, incluindo a regra do último modo obrigatório; a orquestração demonstra a ordem SQL → registry → notificação e separa COMMIT incerto; R3C-D recompõe estado local por nova leitura. As evidências são fixtures PostgreSQL descartáveis, não homologação operacional. Autorização continua `unavailable`.

Dependências SQL: 210 e 211 precisam das tabelas/capturas e da canonicalização do Journal em 209; seus guards imutáveis também usam `orbit_context_evidence_immutable` de 160. A 212 é independente do schema editorial 210/211 e usa `gen_random_uuid`; a fixture R3C foi executada em PostgreSQL 16. Para um teste de toggle, 024 fornece `plugin_settings`, 142 fornece `plugin_installations` (se for validar o bootstrap) e 212 fornece a geração. O runner aplica migrations versionadas numa transação ordenada por nome; schema base/compatibilidade são preparados antes.

Menor caminho para testar toggle sem Discovery Review:

1. Manter a alteração exclusivamente em DEV e usar banco descartável já com schema 024, migration 142 e migration 212. 210/211 não são dependências do toggle; não precisam ser aplicadas para esse teste. R3C já provou a transação central em fixture.
2. Adaptar o `setPluginEnabled` do DEV para delegar a escrita ao repository, mantendo a autorização `plugins.manage`, checks de instalação/definição/perfil e a regra do último quadro. Todo DML ocorre na conexão participante; registry e evento só são atualizados após COMMIT confirmado. Em incerteza, reobservar sem retry de escrita e manter estado/readiness fechados.
3. Antes do teste integrado, fechar a transição: drenar/bloquear o endpoint legado e todas as instâncias que possam gravar; congelar DML administrativo e migrations concorrentes; confirmar uma única versão de writer. Para evitar regressão depois do rollout, escolher uma barreira efetiva de banco (writer estreito com privilégio controlado ou mecanismo equivalente) e provar que versões antigas não conservam DML direto. A fonte atual ainda não implementa essa barreira.
4. Homologar em DEV com duas instâncias, concorrência, falha após COMMIT, COMMIT incerto, registry obsoleto, notificação perdida, rollback e reentrada de versão antiga. Só então repetir a matriz no PROD, Safdoulas e Suindá, cada um no seu banco e preservando suas regras.

## Rollout e rollback

1. Operador prepara e verifica roles, backup recuperável e janela de escrita suspensa.
2. Testes integrados continuam em cluster/banco descartável; confirmar 024/142 e 212. Conferir dependências de 210/211 apenas se o Discovery Review for objeto futuro; elas não são gate deste toggle.
3. Impedir writers legados e SQL administrativo durante cutover; implantar todas as instâncias do runtime-alvo sem convivência com binário antigo gravador.
4. Validar leitura da geração, toggle autorizado, último quadro, consistência entre processos e recuperação após crash. Inspecionar diferença SQL/registry e exigir recusa em qualquer incerteza.
5. Fazer inventário fechado dos writers restantes e repetir em cada produto antes de publicação comum. Rollback mantém geração e dados; nunca restaurar para versão antiga que volte a gravar sem protocolo. Se for inevitável, desabilitar escrita de configurações antes e manter autorização indisponível.
6. Reavaliar R02, R06 e R08 com evidências. Somente após aprovação separada discutir Discovery Review. Não publicar Core nem migrar bancos operacionais nesta etapa.

## Matriz de decisão

| Entrega | Código pronto? | Dependência externa | Risco | Próxima ação |
|---|---|---|---|---|
| Contrato/writer/orquestração/recuperação R3C | Sim, somente fonte e fixtures | Nenhuma para testes descartáveis | Não prova writer real, papéis ou multi-instância operacional | Integrar primeiro DEV com barreira contra legado |
| `setPluginEnabled` participante | Não | Migration 212 no DB alvo; operador para papéis/cutover | Versão mista ignora geração; memória pode divergir | Teste DEV isolado após R06 e plano de fence |
| `plugin_installations` participante | Não há writer operacional; migrations/restore mudam tabela | DDL/grants e procedimento de instalação/restore | Clone conserva domínio e writer administrativo contorna protocolo | Definir se instalação entra no escopo da geração e fechar restore |
| Discovery Review / MCP / Codex nativo | Não, bloqueado | R02, R06, R08, evidência e governança autorizadas | Aprovação indevida e decisão sobre snapshot incompleto | Manter indisponível |

## Próximo prompt recomendado

**07D-R5A — Integração experimental do `setPluginEnabled` em DEV:** implementar somente após operador confirmar a separação e os privilégios R06; migrar endpoint para o writer participante e estabelecer fence comprovável contra SQL/versões legadas; validar em banco descartável com duas instâncias, falhas e rollback. Não projetar, publicar, reiniciar ou liberar autorização editorial.

**Conclusão:** o próximo trabalho que aproxima de operação é integrar um único endpoint DEV sob uma fronteira R06 verificável. Sem confirmação de papéis e sem impedir writers antigos, a integração operacional deve permanecer bloqueada.
