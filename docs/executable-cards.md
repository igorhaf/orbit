# Cartões executáveis

## Arquitetura preservada

Orbit continua usando Next.js/React/Tailwind, NestJS e PostgreSQL (`pg`, SQL explícito), sem Docker. `Board → List → Card`, autenticação JWT, permissões de membros, componentes de cartão, sessões de IA anteriores e suas tabelas permanecem disponíveis. Um cartão comum não precisa de configuração nem cria um Run automaticamente.

A nova capacidade reutiliza o cadastro de projetos locais existente em **Perfil** (`ai_projects`, nome físico preservado), os eventos duráveis de `automation_events`, o worker de automações e os avisos Socket.IO `board:changed`. Não há novo serviço de filas ou infraestrutura externa.

## Modelo e migrations

`npm run db:migrate` aplica os SQL anteriores e as migrations numeradas em `apps/api/sql/migrations/`. `schema_migrations` guarda versão e checksum; cada migration é transacional, protegida por advisory lock. Alterar uma migration já aplicada é rejeitado. Acrescente outra migration para evoluções futuras.

As migrations `001_executable_cards.sql` e `002_project_defaults_and_completion_lists.sql` acrescentam, sem remover dados ou alterar IDs:

| Tabela | Responsabilidade |
| --- | --- |
| `card_execution_configs` | Relação opcional 1:1 com Card; projeto, agente, executor, action, skills, permissões, modo, diretório, referências de contexto, integrações e destinos após execução |
| `card_runs` | Histórico independente, estados, timestamps, heartbeat, snapshot da configuração/cartão, hashes dos recursos, saída, erro e cadeia da automação |
| `card_run_logs` | Etapas e mensagens sanitizadas por execução |

Campos consultáveis (estado, card, executor, projeto e datas) são colunas/indexes. Configurações e resultados extensíveis são JSONB. Nenhuma coluna específica de GitHub ou Codex é adicionada ao Card.

O projeto do cartão é único e usa o vínculo já existente da **Sessão de prompt** (`ai_project_id`). A área de execução não repete um seletor de projeto. O projeto carrega `execution` de `orbit.yaml` como defaults para agente, executor, action, skills, diretório, permissões e contexto. O cartão persiste apenas diferenças em `overrides`; alterar o YAML atualiza automaticamente os campos que não foram personalizados no cartão. A opção **Salvar esta configuração como padrão do projeto** grava esses valores em `orbit.yaml`; destinos de automação continuam locais ao cartão, pois dependem das listas do quadro.

Conceitualmente, o Card mantém seus campos e passa a ter `execution`, `context`, `integrations`, `automation`, `result` e `runs`. O detalhe de execução retorna a configuração completa; o Kanban carrega somente o resumo opcional de execução e o último estado. `result` é derivado do Run mais recente, não de comentários. Runs anteriores não são sobrescritos. A UI lista os últimos 50; os registros mais antigos permanecem no banco e acessíveis pelo ID.

## Conclusão por coluna

No menu de uma lista, **Definir como coluna de conclusão** marca a coluna com um ícone verde. Há no máximo uma coluna ativa por quadro, garantido no banco. Enquanto ela estiver ativa, o status de cada cartão é definido pela lista: cartões nela são concluídos e os demais estão em andamento. O diálogo mostra esse status e direciona a movimentação do cartão; o checkbox manual continua disponível apenas em quadros sem coluna de conclusão. O campo `cards.completed` foi preservado para compatibilidade e é sincronizado quando uma coluna de conclusão existe.

## Recursos do projeto

O `ProjectRegistry` concentra a descoberta e leitura. Usa `.orbit/` quando presente, ou a raiz do projeto. Pastas e `orbit.yaml` são opcionais. Os nomes disponíveis são descobertos sem carregar todo o conteúdo. Recursos selecionados são lidos sob demanda, limitados em tamanho, com validação de caminhos reais e symlinks.

| Recurso | Papel |
| --- | --- |
| `agents/*.md` | Quem executa; instruções, executor padrão, skills, rules, knowledge e teto de permissões |
| `skills/*.md` | O que fazer; instruções e permissões necessárias |
| `knowledge/*.md` | Contexto referenciado, carregado somente quando solicitado |
| `rules/*.md` | Instruções obrigatórias; as declaradas pelo agente sempre entram no contexto |
| `plugins/*.yaml` | Documentação declarativa das capacidades instaladas; não carrega código arbitrário |
| `automations/*.yaml` | Modelos importáveis como regras inicialmente pausadas |

Markdown aceita frontmatter YAML. O `id`, quando declarado, deve corresponder ao nome do arquivo. YAML duplicado, tipos inválidos e aliases excessivos são rejeitados. Configuração inválida aparece como aviso no catálogo e impede executar aquele projeto; não impede usar cartões comuns.

Exemplo mínimo de `.orbit/orbit.yaml`:

```yaml
project:
  name: Meu projeto
  type: software
default_executor: codex
agents: [developer, qa]
plugins: [filesystem]
permissions: [filesystem.read, filesystem.write, process.execute, execution.automatic]
workflow:
  ready: developer
  review: qa
execution:
  agent: developer
  executor: codex
  action: implement-feature
  skills: [implement-feature, create-tests]
  permissions: [filesystem.read, filesystem.write, process.execute]
  context:
    knowledge: [architecture]
    rules: [coding, git]
```

`workflow` é metadado validado, não dispara regras implicitamente. Para disparar, configure/importa uma automação. Sem política declarada, somente leitura e execução de processo podem ser concedidas explicitamente; escrita e execução automática exigem autorização no projeto. As permissões selecionadas no cartão também precisam caber nas permissões do agente.

O repositório inclui exemplos funcionais em `.orbit/`. O `AGENTS.md` da raiz pode entrar no contexto por opção explícita; seu conteúdo não é copiado para os arquivos de agentes.

## Engine, executors e plugins

Fluxo: Card → `CardExecutionService` → `ContextBuilder` → registries de agentes/skills → `ExecutorRegistry` → executor → integrações registradas → resultado e Run.

O ContextBuilder reúne título/descrição, instruções do agente, skills, knowledge/rules referenciados, arquivos selecionados e cartões aos quais o usuário tem acesso. Guarda IDs e hashes dos recursos para auditoria; não armazena nem envia o repositório inteiro. Limite de contexto: 60 KB; arquivo individual: 64 KB.

`Executor` expõe `id`, catálogo de actions/permissões e `execute(ExecutionInput): Promise<ExecutionResult>`. Para instalar outro executor, implemente essa interface e registre-o no serviço. Não é necessário mudar o Card ou a UI de resultados.

`PluginRegistry` registra handlers do backend com input/output schemas JSON, validados por Ajv. Uma integração referencia `{plugin, action, config}`. O plugin precisa estar instalado e habilitado no projeto; sua action exige permissões explícitas. Credenciais pertencem ao ambiente/serviço do backend, nunca à configuração do cartão. Nesta versão existe `filesystem.read`; GitHub/Gmail/Notion etc. são extensões futuras, não integrações simuladas.

O executor genérico `plugin`, action `execute`, executa as integrações configuradas. No executor Codex, integrações rodam após a resposta do agente. Resultados usam `{summary, outputs: [{type, label?, value}]}`. Texto, JSON, arquivos, commits, branches, URLs e outros tipos não precisam de campos especiais no Card. Links HTTP(S) são renderizados como links; outros valores como texto/JSON.

### Codex local

O adapter usa o CLI instalado e a sessão ChatGPT do usuário do servidor (`codex login status`). Não exige colocar token no frontend nem reaproveita credenciais de cartões. Actions iniciais: `analyze`, `implement-feature`, `review-code`.

Executa `codex exec` com argumentos separados (sem shell), prompt por stdin, sandbox `read-only` ou `workspace-write`, aprovação `never`, sessão efêmera e MCP desabilitado. Não utiliza bypass de sandbox. Configuração pessoal do CLI é ignorada para evitar plugins externos inesperados. `CODEX_BIN` é configuração administrativa; `ORBIT_EXECUTION_TIMEOUT_MS` controla o timeout (padrão 5 min, teto 15 min). Cancelamento encerra o grupo do processo.

O ambiente do subprocesso contém apenas variáveis necessárias à sessão/CLI, não as credenciais do banco ou SMTP. O sandbox nativo restringe escritas/rede dos comandos. `process.execute` concede execução de comandos dentro desse sandbox: não é uma ACL por comando, nem uma fronteira de isolamento multitenant. A leitura nativa do CLI pode ser mais ampla que a seleção enviada pelo ContextBuilder. Use somente projetos/agentes confiáveis sob essa conta local. Rules orientam o agente; validação de paths/permissões do serviço protege os recursos carregados e os plugins. O próprio CLI precisa acessar o serviço do provedor para gerar a resposta.

Referências: [modo não interativo](https://learn.chatgpt.com/docs/non-interactive-mode) e [segurança do Codex](https://learn.chatgpt.com/docs/security).

## Runs, concorrência e falhas

Estados: `idle` (sem Run), `queued`, `running`, `success`, `failed`, `cancelled`. A criação usa transação, chave opcional de idempotência, advisory lock por cartão e índice único parcial para um Run ativo. O mesmo lock também protege as sessões de IA anteriores contra execução simultânea.

O worker local consulta a fila a cada 2 segundos e reivindica trabalho com `FOR UPDATE SKIP LOCKED`. Cada processo executa um Run por vez. Heartbeats e pedido persistente de cancelamento permitem acompanhar estado entre processos. Um Run abandonado por mais de dois minutos é marcado como falha, sem repetir automaticamente efeitos externos.

Logs registram criação, agente/executor/skills, recursos, início, integração, resultado e falha. A UI mostra Run, etapa, horário e mensagem. Strings e resultados passam por remoção de credenciais reconhecíveis. Redação não é um detector perfeito de qualquer segredo arbitrário: não inclua credenciais no conteúdo ou nos recursos do projeto.

Cancelamento não desfaz efeitos já executados. Falha numa integração posterior não desfaz ações anteriores externas. Resultados só são confirmados após a sequência; revise os efeitos antes de repetir uma execução falha. Não há garantia de exatamente uma execução em serviços externos.

## Eventos e automações

Reaproveitamos a fila transacional e o worker existentes. Eventos: aliases `card.created`, `card.updated`, `card.moved`, `card.completed`, além de `execution.queued`, `execution.started`, `execution.completed`, `execution.failed`, `execution.cancelled`. Os nomes antigos continuam válidos.

As novas ações passam por `ActionDispatcher`: `run_agent`, `run_skill`, `execute_plugin_action`, `move_card`, `add_label`, `remove_label`, `create_card`, `add_comment`. As ações anteriores permanecem compatíveis. Execuções automáticas exigem cartão habilitado, modo automático e permissão `execution.automatic` no cartão/projeto. Um agente alternativo precisa constar em `orbit.yaml`; as permissões continuam limitadas pelas já concedidas ao cartão.

No cartão, selecione destinos após sucesso/falha. Também é possível configurar regras no editor existente, por exemplo `execution.completed → run_agent` com valor `qa`. A cadeia existente limita ciclos a cinco níveis e impede repetir a mesma regra. Importe modelos da seção **Automações** do cartão, revise e ative no editor do quadro. Importar não ativa nem executa o modelo.

## Exemplo funcional pela interface

1. Execute migrations; mantenha API e web iniciados.
2. Cadastre a pasta deste repositório no Perfil, ou use um projeto já cadastrado.
3. Crie um cartão normal, defina o projeto na **Sessão de prompt** e abra **Execução opcional**.
4. Os campos vêm de `execution` no projeto. Habilite a capacidade e ajuste somente o que for particular ao cartão.
5. Marque **Salvar esta configuração como padrão do projeto** para publicar os ajustes no `orbit.yaml`; deixe desmarcado para manter o ajuste local. As rules/skills/knowledge do agente entram automaticamente.
6. Em **Automações**, escolha `Review` como destino após sucesso. Salve capacidades.
7. Clique **Executar**. Acompanhe **Resultado** e **Histórico de execuções**.
8. Para automatizar o início, autorize modo automático e a permissão correspondente; importe `development-flow` e ative a regra após ajustar a condição `Ready` ao nome da lista. Para QA, crie a regra de sucesso com ação `run_agent`, valor `qa`.

Teste mínimo sem IA: selecione executor `plugin`, action `execute`, permissão de leitura e integração `filesystem / read` apontando para `README.md`. O conteúdo aparece como output. Isso testa a mesma fila e histórico sem chamar um modelo.

## API e validação

Todas as rotas exigem autenticação e acesso ao projeto/cartão/quadro:

| Rota | Uso |
| --- | --- |
| `GET /execution/catalog?project_id=...` | Recursos, executors, actions e permissões disponíveis |
| `GET/PATCH /cards/:id/execution` | Consultar/salvar configuração e resultado |
| `POST /cards/:id/runs` | Enfileirar; body opcional `{request_key}` |
| `GET /execution/runs/:id` | Snapshot, resultado, erro e logs |
| `POST /execution/runs/:id/cancel` | Cancelamento persistente |
| `POST /execution/projects/:id/automations/:template` | Importar modelo pausado; body `{board_id}` |

```sh
npm run db:migrate
npm run test -w apps/api
npm run test:integration -w apps/api
npm run build
# Com API/web iniciados e Chromium instalado:
npm run test:browser -w apps/api
```

Testes unitários cobrem parsing, recursos, configuração, schemas, permissões e paths/symlinks. Integração PostgreSQL cobre compatibilidade, migrations repetidas, concorrência, idempotência, erros, cancelamento, histórico, transições e automações encadeadas com executor determinístico. Navegador cobre configuração, plugin real, resultado, movimentação e histórico em desktop/mobile. Uma chamada real do adapter Codex foi validada separadamente com prompt inofensivo; os testes automatizados não gastam créditos nem implementam tarefas reais de software.

## Arquivos principais

- `apps/api/src/execution/`: engine, registries, contexto, adapter, repository, validação, APIs e testes.
- `apps/api/src/action-dispatcher.ts`: extensões das ações.
- `apps/api/src/migrations.ts` e `sql/migrations/001_executable_cards.sql`: migrations formais.
- `apps/web/components/card-execution.tsx`: seis seções recolhíveis, execução e resultados.
- `apps/web/lib/execution.ts`: contratos da interface.
- `.orbit/`: recursos e fluxo de desenvolvimento de exemplo.
- Alterações incrementais em `main.ts`, `automations.ts`, `automation-rules.ts`, `prompt-sessions.ts`, CardDialog e CardFace conectam a arquitetura sem reescrever o domínio existente.
