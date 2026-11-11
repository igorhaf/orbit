# Extensões genéricas de registros

As capacidades reutilizáveis ficam em `apps/api/src/plugins/records/`, sem entidades ou regras de clientes no core.

Plugins de domínio podem estender a capacidade compartilhada sem alterar a lógica do plugin-base. Declare `parentPlugin` para identificar o host funcional e mantenha-o também em `dependencies`; o registry valida a relação, expõe pai e filhos no catálogo e herda o ciclo de ativação pelas dependências. Regras de cada produto continuam no plugin filho.

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

Campos de schema podem declarar a extensão de interface `recordKind` para mostrar um seletor dos registros desse tipo que o usuário pode consultar no workspace. `recordRevisionField` preenche o número da revisão selecionada. Essa sugestão de interface não substitui a validação do plugin; relações e permissões precisam ser verificadas novamente no servidor.

Plugins podem declarar `publicRead` em um tipo para disponibilizar uma projeção anônima com estados e campos explicitamente permitidos. Validadores que resolvem relações aplicam a mesma projeção quando o ator não tem acesso ao workspace; isso permite validar uma inscrição contra um curso público sem liberar sua leitura geral. `publicRelatedList` limita os registros relacionados ao workspace e à revisão referenciada. Para itens com vagas, `seatAvailability` define o campo de capacidade e os estados que ocupam lugar; a projeção calcula os lugares restantes sem expor os registros individuais. `personalOwnerField` permite que `GET /extensions/:plugin/me/records/:kind` liste somente registros próprios de um tipo privado, depois de aplicar a política de autorização e gravar a auditoria. Tipos com `serverCreated` são persistidos apenas por operações do plugin confiável, enquanto suas respostas continuam protegidas pelo escopo individual.

As regras de validação de domínio podem usar `listLatestRecords` para consultar um conjunto limitado de registros atuais do mesmo workspace por plugin, tipo, estado e correspondência de campos JSON. A consulta impõe limite máximo de mil linhas e não expõe resultados em uma rota; o uso é interno a validadores/transições. Opcionalmente, `lockScope` serializa operações relacionadas dentro da transação.

## API e persistência

- `GET /extensions` lista os contratos e a disponibilidade efetiva.
- `GET /extensions/:plugin/workspaces/:workspace/access` informa as permissões efetivas de escrita e publicação.
- `GET|POST /extensions/:plugin/workspaces/:workspace/records` consulta até 100 registros recentes ou cria um registro.
- `GET /extensions/:plugin/workspaces/:workspace/summary` agrega tipo e estado dos registros aos quais o usuário tem acesso, sem retornar seus payloads.
- `GET /extensions/:plugin/records/:id` consulta o registro, até 100 versões, as referências e as próximas transições.
- As rotas públicas específicas de um plugin usam projeções `publicRead`; relações públicas e disponibilidade derivada continuam limitadas pelas definições do plugin.
- `POST /extensions/:plugin/records/:id/versions` cria uma revisão com `expected_revision`, `reason` e `operation_key`.
- `POST /extensions/:plugin/records/:id/transitions` executa uma transição definida pelo plugin.
- `POST /extensions/:plugin/records/:id/links` fixa `target_id`, `target_revision` e `relation` no mesmo workspace.
- `POST /extensions/terms/records/:id/acceptances` registra um aceite explícito de uma versão publicada.
- `POST /extensions/documents/workspaces/:workspace/files` recebe um arquivo base64 de até 8 MB.
- `GET /extensions/documents/records/:id/files/:revision` verifica o hash e entrega a versão como download autenticado.
- `GET /extensions/:plugin/records/:id/attachments/:revision/:attachmentId` entrega um anexo da revisão autenticada após aplicar a política do tipo de registro e verificar SHA-256.
- `GET /extensions/audit-history` verifica a cadeia inteira e devolve os 100 eventos mais recentes.

Toda mutação usa uma chave UUID de idempotência isolada por usuário, plugin e workspace, rejeita o reaproveitamento com conteúdo diferente e conclui dados, histórico e auditoria na mesma transação.

As versões publicadas permanecem imutáveis mesmo quando uma nova revisão cria um novo rascunho; respostas submetidas, processos concluídos e demais estados terminais não podem ser editados.

Formulários e processos fixam a versão de sua definição, e alterações posteriores na definição não mudam respostas ou processos existentes.

As tabelas compartilhadas não acrescentam campos aos cartões do core; novas extensões consomem o serviço por seu contrato e mantêm seus campos no catálogo do plugin.

## Documentos

O plugin aceita PDF, PNG, JPEG, texto UTF-8, DOCX e XLSX, valida assinatura de formato, tamanho, nome, hash e participação no workspace.

`ORBIT_DOCUMENT_SCANNER_BIN` é uma configuração opcional do próprio plugin; quando definida, erro, timeout ou indisponibilidade do scanner bloqueiam o envio, e um upload sem scanner fica marcado como `not_configured`.

## Anexos de registros

Plugins podem associar vários arquivos a uma revisão imutável pela tabela genérica `extension_record_attachments`. A migration `144_record_attachments.sql` guarda nome, MIME, tamanho, hash, resultado do scanner, conteúdo binário e autor; a FK exige que a revisão exista e um trigger impede atualização ou exclusão. Plugins definem a leitura pelo hook `authorizeAttachment`, ou herdam a autorização do registro. O download é privado, não armazenável em cache, verifica o SHA-256 e grava auditoria. A operação acadêmica de envio de atividade grava seus anexos e a revisão da entrega na mesma transação.

Uma variante anonimizada referencia uma versão original, e sua publicação exige uma revisão aprovada por alguém que não tenha enviado o original nem a cópia.

## Migrations e validação

As migrations genéricas `079`, `096`, `099`, `100` e `102` mantêm nomes e checksums, enquanto `118` e `119` criam a persistência reutilizável e a auditoria verificável.

A migration histórica `065` permanece intacta para compatibilidade de checksum; `120` remove os perfis de cliente que essa versão antiga inseria, inclusive em instalações novas.

O teste de integração instala o schema completo do zero em um namespace temporário, executa jornadas dos plugins, confirma a autorização e a imutabilidade, repete as migrations e remove o namespace ao final.

Execute `npm run test:integration:dev` para a suíte completa em um banco descartável, criado e removido pelo executor sem ampliar as permissões do banco real.

Para verificar apenas os registros genéricos, execute `node scripts/with-dev-database.mjs --isolated npx tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/plugins/records/records.integration.spec.ts`.

As verificações autorizadas são lint, TypeScript, testes unitários, testes da API e banco isolado; não execute navegadores ou Selenium neste host.
