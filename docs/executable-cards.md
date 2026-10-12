# Cartões executáveis

## Arquitetura preservada

Orbit continua usando Next.js/React/Tailwind, NestJS e PostgreSQL (`pg`, SQL explícito), com ambientes Docker separados. `Board → List → Card`, autenticação JWT, permissões de membros, componentes de cartão, sessões de IA anteriores e suas tabelas permanecem disponíveis. Um cartão comum não precisa de configuração nem cria um Run automaticamente.

A nova capacidade reutiliza o cadastro de projetos locais existente em **Perfil** (`ai_projects`, nome físico preservado), o worker de execuções e os avisos Socket.IO `board:changed`. Não há novo serviço de filas ou infraestrutura externa.

## Modelo e migrations

`npm run db:migrate` aplica os SQL anteriores e as migrations numeradas em `apps/api/sql/migrations/`. `schema_migrations` guarda versão e checksum; cada migration é transacional, protegida por advisory lock. Alterar uma migration já aplicada é rejeitado. Acrescente outra migration para evoluções futuras.

As migrations `001_executable_cards.sql` e `002_project_defaults_and_completion_lists.sql` acrescentam, sem remover dados ou alterar IDs:

| Tabela | Responsabilidade |
| --- | --- |
| `card_execution_configs` | Relação opcional 1:1 com Card; projeto, agente, executor, action, skills, permissões, modo, diretório, referências de contexto, integrações e destinos após execução |
| `card_runs` | Histórico independente, estados, timestamps, heartbeat, snapshot da configuração/cartão, hashes dos recursos, saída e erro |
| `card_run_logs` | Etapas e mensagens sanitizadas por execução |

Campos consultáveis (estado, card, executor, projeto e datas) são colunas/indexes. Configurações e resultados extensíveis são JSONB. Nenhuma coluna específica de GitHub ou Codex é adicionada ao Card.

O projeto do cartão usa o vínculo de **IA do cartão**, com herança das configurações do quadro e projeto. Configurações internas de executor, skills, permissões, limites de arquivos e verificações são definidas em `.orbit/orbit.yaml` e na API `GET/PATCH /cards/:id/execution`.

A interface atual usa **IA do cartão**, **Contextos** com vínculos vivos, **Próximo prompt** e **Execução**. Os painéis antigos **Execução opcional**, **Contexto**, **Limites de alteração** e **Integrações** foram removidos. Uma configuração persistida no backend não deve fazê-los reaparecer. Execuções Codex são registradas em `card_ai_runs` e exibidas na aba Execução; o histórico legado de `card_runs` continua disponível pela API para os executores que o utilizam.

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

Markdown aceita frontmatter YAML. O `id`, quando declarado, deve corresponder ao nome do arquivo. YAML duplicado, tipos inválidos e aliases excessivos são rejeitados. Configuração inválida aparece como aviso no catálogo e impede executar aquele projeto; não impede usar cartões comuns.

Exemplo mínimo de `.orbit/orbit.yaml`:

```yaml
project:
  name: Meu projeto
  type: software
default_executor: codex
agents: [developer, qa]
plugins: [filesystem]
permissions: [filesystem.read, filesystem.write, process.execute]
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

As permissões selecionadas no cartão também precisam caber nas permissões do agente.

O repositório inclui exemplos funcionais em `.orbit/`. O `AGENTS.md` da raiz pode entrar no contexto por opção explícita; seu conteúdo não é copiado para os arquivos de agentes.

## Engine, executors e plugins

Fluxo: Card → `CardExecutionService` → `ContextBuilder` → registries de agentes/skills → `ExecutorRegistry` → executor → integrações registradas → resultado e Run.

O ContextBuilder reúne título/descrição, instruções do agente, skills, knowledge/rules referenciados, arquivos selecionados e cartões aos quais o usuário tem acesso. Guarda IDs e hashes dos recursos para auditoria; não armazena nem envia o repositório inteiro. Limite de contexto: 60 KB; arquivo individual: 64 KB.

`Executor` expõe `id`, catálogo de actions/permissões e `execute(ExecutionInput): Promise<ExecutionResult>`. Para instalar outro executor, implemente essa interface e registre-o no serviço. Não é necessário mudar o Card ou a UI de resultados.

`PluginRegistry` registra handlers do backend com input/output schemas JSON, validados por Ajv. Uma integração referencia `{plugin, action, config}`. O plugin precisa estar instalado e habilitado no projeto; sua action exige permissões explícitas. Credenciais pertencem ao ambiente/serviço do backend, nunca à configuração do cartão. Nesta versão existe `filesystem.read`; GitHub/Gmail/Notion etc. são extensões futuras, não integrações simuladas.

O executor genérico `plugin`, action `execute`, executa as integrações configuradas. No executor Codex, integrações rodam após a resposta do agente. Resultados usam `{summary, outputs: [{type, label?, value}]}`. Texto, JSON, arquivos, commits, branches, URLs e outros tipos não precisam de campos especiais no Card. Links HTTP(S) são renderizados como links; outros valores como texto/JSON.

### Codex local

O adapter usa o CLI instalado e a sessão ChatGPT do usuário do servidor (`codex login status`). Não exige colocar token no frontend nem reaproveita credenciais de cartões. Actions iniciais: `analyze`, `implement-feature`, `review-code`.

Executa `codex exec` com argumentos separados (sem shell), prompt por stdin e acesso total ao ambiente, sem sandbox e sem confirmação. As sessões ficam persistidas em `.orbit/sessions`; o `auth.json` é compartilhado por link simbólico com o `CODEX_HOME` global para preservar o login. A configuração pessoal do CLI é ignorada e MCPs são desabilitados. `CODEX_BIN` é configuração administrativa; `ORBIT_EXECUTION_TIMEOUT_MS` controla o timeout (padrão 5 min, teto 15 min). Cancelamento encerra o grupo do processo.

O ambiente do subprocesso contém apenas variáveis necessárias à sessão/CLI, não as credenciais do banco ou SMTP. Como o Codex tem acesso total ao usuário local, use somente projetos e agentes confiáveis sob essa conta. As permissões configuradas na action descrevem a intenção da tarefa, mas não limitam o processo Codex. Validação de paths/permissões do serviço protege os recursos carregados e os plugins. O próprio CLI precisa acessar o serviço do provedor para gerar a resposta.

Referências: [modo não interativo](https://learn.chatgpt.com/docs/non-interactive-mode) e [segurança do Codex](https://learn.chatgpt.com/docs/security).

## Runs, concorrência e falhas

Estados: `idle` (sem Run), `queued`, `running`, `success`, `failed`, `cancelled`. A criação usa transação, chave opcional de idempotência, advisory lock por cartão e índice único parcial para um Run ativo. O mesmo lock também protege as sessões de IA anteriores contra execução simultânea.

O worker local consulta a fila a cada 2 segundos e reivindica trabalho com `FOR UPDATE SKIP LOCKED`. Cada processo executa um Run por vez. Heartbeats e pedido persistente de cancelamento permitem acompanhar estado entre processos. Um Run abandonado por mais de dois minutos é marcado como falha, sem repetir automaticamente efeitos externos.

Logs registram criação, agente/executor/skills, recursos, início, integração, resultado e falha. A UI mostra Run, etapa, horário e mensagem. Strings e resultados passam por remoção de credenciais reconhecíveis. Redação não é um detector perfeito de qualquer segredo arbitrário: não inclua credenciais no conteúdo ou nos recursos do projeto.

Cancelamento não desfaz efeitos já executados. Falha numa integração posterior não desfaz ações anteriores externas. Resultados só são confirmados após a sequência; revise os efeitos antes de repetir uma execução falha. Não há garantia de exatamente uma execução em serviços externos.

## Eventos e automações

Reaproveitamos a fila transacional e o worker existentes. Eventos: aliases `card.created`, `card.updated`, `card.moved`, `card.completed`, além de `execution.queued`, `execution.started`, `execution.completed`, `execution.failed`, `execution.cancelled`. Os nomes antigos continuam válidos.


Configure regras no editor de automações do quadro. Não recrie formulários de automação nos cartões. A cadeia existente limita ciclos a cinco níveis e impede repetir a mesma regra.

## Fluxo atual pela interface

1. Selecione o projeto em **IA do cartão**, ou herde o projeto padrão do quadro.
2. Preencha descrição e checklist; vincule referências pela seção **Contextos**.
3. Configure os limites e verificações do projeto pela API e `.orbit/orbit.yaml`, quando exigidos.
4. Use o botão de execução da descrição ou comentários. Confira **Próximo prompt** e acompanhe o histórico real na aba **Execução**.
5. Aprove a demanda somente após conferir alterações e verificações reais.

Executores legados e plugins continuam disponíveis pelas rotas de execução abaixo. Eles não introduzem outro painel de configuração no cartão.

## API e validação

Todas as rotas exigem autenticação e acesso ao projeto/cartão/quadro:

| Rota | Uso |
| --- | --- |
| `GET /execution/catalog?project_id=...` | Recursos, executors, actions e permissões disponíveis |
| `GET/PATCH /cards/:id/execution` | Consultar/salvar configuração e resultado |
| `POST /cards/:id/runs` | Enfileirar; body opcional `{request_key}` |
| `GET /execution/runs/:id` | Snapshot, resultado, erro e logs |
| `POST /execution/runs/:id/cancel` | Cancelamento persistente |

```sh
npm run db:migrate
npm run test -w apps/api
npm run test:integration -w apps/api
npm run build
# Com API/web iniciados e Chromium instalado:
npm run test:browser -w apps/api
```

Testes unitários cobrem parsing, recursos, configuração, schemas, permissões e paths/symlinks. Integração PostgreSQL cobre compatibilidade, migrations repetidas, concorrência, idempotência, erros, cancelamento, histórico, transições com executor determinístico. Selenium cobre cartões convertidos e configurados, a referência Orbit, ausência dos painéis antigos e navegação por toque nas abas atuais; também verifica que contextos e configuração interna permanecem intactos. Uma chamada real do adapter Codex foi validada separadamente com prompt inofensivo; os testes automatizados não gastam créditos nem implementam tarefas reais de software.

## Arquivos principais

- `apps/api/src/execution/`: engine, registries, contexto, adapter, repository, validação, APIs e testes.
- `apps/api/src/migrations.ts` e `sql/migrations/001_executable_cards.sql`: migrations formais.
- `apps/web/components/card-execution.tsx`: seis seções recolhíveis, execução e resultados.
- `apps/web/lib/execution.ts`: contratos da interface.
- `.orbit/`: recursos e fluxo de desenvolvimento de exemplo.
- Alterações incrementais em `main.ts` e `prompt-sessions.ts`, CardDialog e CardFace conectam a arquitetura sem reescrever o domínio existente.

### Modos de IA e fila de perguntas

Em IA do cartão, Permissivo mantém o valor de API `bypass`, Planejamento mantém
`planning` e Questionar usa `question`. Questionar examina o projeto em leitura
e solicita uma decisão antes de implementar. A pergunta fica persistida em
`card_ai_runs.status = waiting_answer`, fora da fila de execução e sem reter
os bloqueios do cartão ou projeto. Outros cartões continuam a executar.

A aba Execução apresenta a pergunta e recebe a resposta. O endpoint autenticado
`POST /cards/:id/prompt-runs/:runId/answer` aceita apenas `{ "answer": "..." }`,
com texto não vazio de até 4000 caracteres. Exige acesso ao quadro e o autor
da execução; respostas duplicadas ou a execuções fora da espera retornam 409.
A resposta recoloca a mesma execução na fila normal, respeitando pausa,
ordem e bloqueios existentes, e retoma a sessão, modelo e projeto anteriores.
Se outra decisão for necessária, a execução pode voltar à espera.
`GET /codex/queue` inclui `waitingAnswers` do usuário para a fila de perguntas.
Execuções em espera podem ser canceladas pelo endpoint de cancelamento existente.
A espera sobrevive à reinicialização e não é considerada heartbeat vencido.

O executor sinaliza perguntas com um bloco final não vazio
`[[ORBIT_QUESTION]] ... [[/ORBIT_QUESTION]]`. Verificações de conclusão rodam
quando a implementação conclui; escopo de escrita permanece validado em cada turno.
A migração `060_prompt_questions.sql` habilita os novos valores persistidos.
