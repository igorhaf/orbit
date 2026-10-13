# Plugins e layouts de cartões

## Uso

No cartão, abra **Plugins do cartão** e selecione os recursos desejados. Um cartão novo é básico (descrição, anexos, checklist, Contextos e comentários). **Inteligência artificial** acrescenta assistência, prompts e execução; **Desenvolvimento de software** acrescenta Git e depende de IA. Selecionar desenvolvimento inclui IA automaticamente. Retirar IA do cartão também retira seus dependentes da seleção, preservando configurações, respostas e dados.

Os cartões existentes foram migrados para preservar suas funcionalidades. Conversões de checklist e cópias herdam os plugins e seus dados. O cofre permanece independente desses layouts.

Em `/plugins`, desativar IA suspende todos os plugins que dependem dela, incluindo desenvolvimento e Alexa. A configuração desejada do dependente é preservada e sua disponibilidade retorna quando as dependências forem reativadas. O estado é global à instalação; a seleção de layouts é por cartão.

## Tipos primários de cartão

Layouts complementam o cartão. Tipos primários definem o domínio do cadastro, como desenvolvimento, gestão ou evento, e são declarados por plugins em `contributions.cardTypes`. O usuário Root escolhe quais tipos ficam disponíveis na instalação e pode sobrescrever essa disponibilidade por quadro. Sem uma regra específica no quadro, vale a configuração global. Um plugin indisponível por dependência não oferece seus tipos.

O tipo escolhido é persistido em `card_plugin_layouts.card_type_id`; o dado e o layout do plugin continuam desacoplados do núcleo. A API entrega os tipos efetivos do quadro e filtra as opções pela permissão `cards.type.<id>.use` quando houver mais de um tipo elegível. Root administra o catálogo e as regras globais e por quadro. Com zero ou um tipo efetivo, a interface não mostra seletor; o tipo único é aplicado por configuração. Com vários tipos, usuários veem apenas os tipos autorizados pelo RBAC. Tipos não devem ser solicitados ao criar projeto, quadro ou coluna: a configuração global e o escopo do quadro determinam o tipo dos novos cartões.

Configuração administrativa: `GET/PATCH /card-types/config`. Consulta de opções por quadro: `GET /boards/:id/card-types`. Consulta e alteração do cartão: `GET/PATCH /cards/:id/type`. A alteração exige autorização no quadro e a permissão de uso do tipo. O plugin que declara um tipo pode registrar slots próprios; outros plugins podem complementar esse tipo sem assumir sua identidade primária.

## Contrato para plugins

`PluginDefinition.dependencies` contém IDs de plugins obrigatórios. Dependências ausentes ou ciclos tornam o plugin indisponível; ciclos são rejeitados no registro. A verificação acontece também na API e no executor, sem depender da interface.

`contributions.cardLayouts` declara `id`, `name`, `slots` e, opcionalmente, `fields` (chave, rótulo, tipo text/textarea e tamanho máximo). O renderer genérico mostra os campos declarados e salva os valores no namespace do plugin. Nunca adicione campos inventados ao contrato de criação/atualização do cartão. Para UI especializada, mantenha o componente no diretório do plugin e use um slot registrado pelo cliente.

Slots atuais: `ai.controls`, `ai.comments`, `ai.prompt`, `ai.execution`, `development.git`. Slots são identificadores de componentes compilados; não executam HTML/JavaScript enviado pela API. Novos componentes especializados exigem registrar seu renderer no cliente.

Seleção: `GET/PATCH /cards/:id/plugins`, corpo `{ "plugins": ["software-development"] }`. A API resolve a seleção para IA + desenvolvimento. Campos: `PATCH /cards/:id/plugins/:pluginId/fields`, apenas chaves declaradas por aquele plugin. RBAC e autorização do quadro são obrigatórios.

## Separação

Implementação do provedor, orquestração e sugestões: `apps/api/src/plugins/ai`. O core usa a porta opcional `ORBIT_AI_CARD`. Os arquivos antigos `codex-ai.ts` e `prompt-sessions.ts` são exports de compatibilidade. As rotas de projetos continuam disponíveis com IA desligada; seus nomes históricos `/ai/projects` são preservados para compatibilidade.

A UI de IA fica em `apps/web/plugins/ai`; o painel de desenvolvimento em `apps/web/plugins/software-development`. A composição da aplicação registra os serviços dos plugins, como faz com os demais plugins existentes. Desativar não descarrega classes em memória: bloqueia novas operações e pausa filas; processos já iniciados podem concluir.

`CODEX_BIN` e `CODEX_AI_TIMEOUT_MS` pertencem à configuração do plugin IA. Credenciais e modelo de conta continuam usando o mecanismo existente; não se exige uma chave de API para a conta Codex local. As permissões `ai.*` e `queues.*` aparecem com origem IA no catálogo RBAC, mantendo IDs e perfis existentes.

O serviço genérico `ai.complete` recebe instrução, modelo e esforço, e retorna texto. Pode ser reutilizado por plugins; exige `ai.write` e segue o autorizador do registro. Dependências não concedem privilégios a usuários.

## Validação

`npm run build`; `npm test -w apps/api`; `ORBIT_SELENIUM_DB_HOST=<host-db> node .orbit/validations/card-plugins/card-plugins.selenium.mjs`; `ORBIT_SELENIUM_DB_HOST=<host-db> npm run test:selenium:mobile`.

## Função dos cartões de desenvolvimento

O plugin `software-development` declara o campo `role`: `executable` (Executável) ou `context` (Contexto). O valor fica em `card_plugin_layouts.data`, sem novos campos de mutação no core. A contribuição declara rótulos, cores e bloqueio; o core interpreta essa declaração genérica.

O rótulo aparece no quadro, na Gestão estruturada e no cartão aberto. A função pode ser alterada nos campos do plugin. Contextos conservam descrição, checklists e relações, mas não oferecem ações de execução/commit; as APIs rejeitam novas execuções. A classificação como contexto é recusada enquanto houver execução pendente. Dados anteriores de execução são preservados.

Uma relação pai/filho não determina a função: um executável pode ser contexto para outro cartão. Ao converter checklist em filho, o campo recebe o `childDefault` declarado pelo plugin (Executável para desenvolvimento), mantendo a herança do pai. Cartões antigos sem classificação exibem “Não classificado” até uma escolha explícita.

SAFDOULA: 94 demandas Dxx executáveis e 26 contextos (principal, base, referências, jornadas e roteiro QA). Nenhuma demanda é iniciada pela classificação.
