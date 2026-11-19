# 07D-R5B — Preflight do toggle no DEV

## Estado confirmado

- Core 1.12.5 e 231 mappings no workspace, pacote e quatro locks.
- 210–212 estão somente em packages. R3C e R5A existem na fonte experimental e no harness.
- R02, R06 e R08 permanecem abertos. Discovery Review segue indisponível.
- O endpoint operacional DEV permanece legado e usa o pool geral. Não foi aberto banco operacional nem consultado `.env`.

## Fronteira atual

O adaptador experimental recebe um `Pool` geral e outro de configuração e rejeita o mesmo objeto. Isso não comprova identidades PostgreSQL distintas. O serviço experimental está fora do bootstrap e do build operacional. A prova R5A usou logins independentes apenas no PostgreSQL descartável.

O caminho antigo `setPluginEnabled` grava diretamente `plugin_settings`. Migrations, SQL administrativo e restauração do banco também podem alterar configuração. O bootstrap lê settings e instalações e atualiza o registry local. Não há evidência de inventário de ferramentas externas nem da quantidade de processos DEV em execução.

## Script diagnóstico

`tools/orbit/editorial-dev-sql-preflight.sql` é somente leitura. Execute manualmente, em sessão separada para cada credencial de runtime geral, writer de configuração (se existir) e migration. O script mostra identidade efetiva, flags do papel, memberships, ownership, privilégios de tabela e coluna, ACL de schema/funções, triggers e migrations 210–212. Não recebe nem imprime credenciais.

O operador deve confirmar que a role geral pode consultar settings, mas não fazer DML, assumir writer/owner ou administrar schema, ACLs e triggers. A role writer recebe somente as colunas exigidas por R3C-B e o controle da revisão. A role migradora mantém DDL e ownership. O leitor não precisa de lock PostgreSQL `FOR SHARE`, pois esse modo também exige UPDATE. A geração continua indisponível para autorização.

## Gates de ativação

| Gate | Evidência e verificação | Falha impeditiva | Responsável | Estado |
|---|---|---|---|---|
| G1 Identidade e privilégios | Saída do script para cada login, incluindo memberships, grants efetivos e ownership | Identidade compartilhada, superuser/owner no runtime, DML legado ou ACL administrativa | Operador DBA | PENDENTE |
| G2 Schema | Migration 212 registrada e hash/objetos validados no banco DEV correto | Migration ausente, parcial ou divergente | Operador DBA | PENDENTE |
| G3 Exclusividade | Inventário e drenagem de APIs antigas, migrations concorrentes, SQL administrativo, restore e ferramentas externas. Rejeição SQL pelo login geral | Qualquer writer legado pode escrever | Operador e responsável DEV | BLOQUEADO |
| G4 Segurança da aplicação | Montagem futura mantém AccessGuard, ator validado e `plugins.manage`; nenhuma credencial é acessível a plugins/HTTP | Writer acessível sem autorização ou por parâmetro do cliente | Responsável DEV | PENDENTE |
| G5 Consistência local | Falha após COMMIT sinaliza stale; COMMIT incerto não repete DML; reconciliação somente por leitura | Resultado ambíguo reportado como sucesso | Responsável DEV | COMPROVADO EM FIXTURE |
| G6 Versões e rollback | Prova que binário antigo no rollback continua sem DML e que restore não reabre escrita | Rollback recupera privilégio legado ou perde geração | Operador e responsável DEV | BLOQUEADO |
| G7 Integração multi-instância | Dois processos, logins e pools independentes, CAS, restart e recuperação em banco descartável | Fixture de mesmo processo ou uma identidade SQL para ambos | Responsável DEV | PENDENTE |

## Corte proposto

1. Operador executa o diagnóstico manualmente para as credenciais autorizadas e entrega evidências sem segredos.
2. Separar runtime geral, writer privado e migration. Revogar do login geral o DML de settings e geração. Confirmar que não há memberships ou caminhos de escalada.
3. Aplicar e validar 212 apenas no banco descartável para ensaios. Em DEV operacional, qualquer aplicação exige decisão e execução do operador.
4. Bloquear e drenar writers antigos, automações SQL e migrations concorrentes. Confirmar ausência de transações abertas e de instâncias antigas.
5. Provar o corte com dois processos independentes e as credenciais reais aprovadas, incluindo rollback para código antigo com DML ainda negado.
6. Só então montar o serviço no endpoint DEV e validar a operação. Preservar rollback do código sem reverter ACLs nem conceder escrita antiga.

## Decisão

**BLOQUEADO para homologação operacional.** G1–G4, G6 e G7 carecem de evidências reais ou integração no host. G5 só está comprovado pela fixture R5A. R02, R06 e R08 continuam abertos. O próximo passo é a execução manual do script por operador autorizado, seguida da comprovação de G3 e G6. Não iniciar R5C até esses resultados serem revisados.
