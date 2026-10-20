# Extensões genéricas de registros

As capacidades reutilizáveis ficam em `apps/api/src/plugins/records/`, sem entidades ou regras de clientes no core.

| Plugin              | Recursos                                                                          |
| ------------------- | --------------------------------------------------------------------------------- |
| `versioned-records` | Persistência por workspace, versões imutáveis, referências fixadas e idempotência |
| `reference-library` | Documentos normativos, diretrizes, fontes, temas e publicação                     |
| `policy-parameters` | Parâmetros com limites, fontes e versões publicadas                               |
| `terms`             | Termos publicados e aceite explícito com hash por usuário e versão                |
| `assessments`       | Matrizes, dimensões, critérios e resultados configuráveis                         |
| `privacy`           | Atividades de tratamento e solicitações de titulares com referência opaca         |
| `compliance`        | Declarações de relações e acompanhamento de conflitos de interesse                |
| `forms`             | JSON Schema local, rascunhos e submissões imutáveis                               |
| `workflows`         | Definições de fluxo, processos, protocolo, triagem e complementos                 |
| `deadlines`         | Prazos com pausa, retomada, prorrogação e conclusão                               |
| `documents`         | Arquivos versionados, hashes, variantes anonimizadas e revisão independente       |
| `audit-history`     | Verificação da cadeia de auditoria do Orbit                                       |

Cada extensão depende da base `versioned-records`, que depende de Workspaces; suspender uma base suspende seus dependentes sem apagar dados nem alterar suas escolhas individuais de ativação.

## Interface e permissões

A entrada única “Extensões” abre `/extensions`, com os plugins autorizados pelo RBAC, e cada plugin abre `/extensions/<plugin>` com seleção de workspace, registros, revisão, publicação, referências e histórico; os exemplos genéricos são modelos opcionais carregados pelo usuário.

O core continua responsável pelo RBAC, e os plugins declaram `plugin.<id>.read`, `plugin.<id>.write` e `plugin.<id>.publish`; cada operação combina a permissão com a participação no workspace, e ROOT mantém acesso total.

A auditoria verificável usa `access.audit.read`, registra eventos novos a partir da instalação da migration `119` e preserva a auditoria anterior sem alegar proteção retroativa.

## API e persistência

- `GET /extensions` lista os contratos e a disponibilidade efetiva.
- `GET /extensions/:plugin/workspaces/:workspace/access` informa as permissões efetivas de escrita e publicação.
- `GET|POST /extensions/:plugin/workspaces/:workspace/records` consulta até 100 registros recentes ou cria um registro.
- `GET /extensions/:plugin/records/:id` consulta o registro, até 100 versões, as referências e as próximas transições.
- `POST /extensions/:plugin/records/:id/versions` cria uma revisão com `expected_revision`, `reason` e `operation_key`.
- `POST /extensions/:plugin/records/:id/transitions` executa uma transição definida pelo plugin.
- `POST /extensions/:plugin/records/:id/links` fixa `target_id`, `target_revision` e `relation` no mesmo workspace.
- `POST /extensions/terms/records/:id/acceptances` registra um aceite explícito de uma versão publicada.
- `POST /extensions/documents/workspaces/:workspace/files` recebe um arquivo base64 de até 8 MB.
- `GET /extensions/documents/records/:id/files/:revision` verifica o hash e entrega a versão como download autenticado.
- `GET /extensions/audit-history` verifica a cadeia inteira e devolve os 100 eventos mais recentes.

Toda mutação usa uma chave UUID de idempotência isolada por usuário, plugin e workspace, rejeita o reaproveitamento com conteúdo diferente e conclui dados, histórico e auditoria na mesma transação.

As versões publicadas permanecem imutáveis mesmo quando uma nova revisão cria um novo rascunho; respostas submetidas, processos concluídos e demais estados terminais não podem ser editados.

Formulários e processos fixam a versão de sua definição, e alterações posteriores na definição não mudam respostas ou processos existentes.

As tabelas compartilhadas não acrescentam campos aos cartões do core; novas extensões consomem o serviço por seu contrato e mantêm seus campos no catálogo do plugin.

## Documentos

O plugin aceita PDF, PNG, JPEG, texto UTF-8, DOCX e XLSX, valida assinatura de formato, tamanho, nome, hash e participação no workspace.

`ORBIT_DOCUMENT_SCANNER_BIN` é uma configuração opcional do próprio plugin; quando definida, erro, timeout ou indisponibilidade do scanner bloqueiam o envio, e um upload sem scanner fica marcado como `not_configured`.

Uma variante anonimizada referencia uma versão original, e sua publicação exige uma revisão aprovada por alguém que não tenha enviado o original nem a cópia.

## Migrations e validação

As migrations genéricas `079`, `096`, `099`, `100` e `102` mantêm nomes e checksums, enquanto `118` e `119` criam a persistência reutilizável e a auditoria verificável.

A migration histórica `065` permanece intacta para compatibilidade de checksum; `120` remove os perfis de cliente que essa versão antiga inseria, inclusive em instalações novas.

O teste de integração instala o schema completo do zero em um namespace temporário, executa jornadas dos plugins, confirma a autorização e a imutabilidade, repete as migrations e remove o namespace ao final.

Execute `npm run test:integration:dev` para a suíte completa em um banco descartável, criado e removido pelo executor sem ampliar as permissões do banco real.

Para verificar apenas os registros genéricos, execute `node scripts/with-dev-database.mjs --isolated npx tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/plugins/records/records.integration.spec.ts`.

As verificações autorizadas são lint, TypeScript, testes unitários, testes da API e banco isolado; não execute navegadores ou Selenium neste host.
