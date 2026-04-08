
# Regras de Negócio — Sistema ORBIT

Documento consolidado com todas as regras extraídas dos arquivos `BUSINESS_RULES_EXTRACTION.md` e `ORBIT_REPORT.md`.

---

## Hierarquia de Itens

**Hierarquia estrita em 4 níveis**
O sistema segue obrigatoriamente a hierarquia: Epic → Story → Task/Bug → Subtask.
Nenhum item pode pular ou inverter níveis — um Task, por exemplo, não pode ser filho direto de um Epic.

**Epic só aceita Story como filho**
Ao criar um item filho de um Epic, o tipo permitido é exclusivamente Story.
Tentativas de criar Task, Bug ou Subtask diretamente abaixo de um Epic são rejeitadas pelo sistema.

**Story aceita Task ou Bug como filhos**
Uma Story pode ter como filhos diretos apenas itens do tipo Task ou Bug.
Não são permitidos Epic, Story ou Subtask como filhos diretos de uma Story.

**Task só aceita Subtask como filho**
Uma Task pode ter apenas Subtasks como filhos — nenhum outro tipo é permitido.
Isso garante que o nível mais operacional da hierarquia seja sempre a Subtask.

**Subtask e Bug são folhas (sem filhos)**
Subtask e Bug são nós terminais da hierarquia — não podem ter filhos de nenhum tipo.
Qualquer tentativa de criar um item filho abaixo deles é bloqueada pelo sistema.

**Deleção em cascata de pai para filhos**
Ao deletar um item pai (ex: Epic), todos os seus filhos são automaticamente deletados em cascata.
Essa regra é recursiva: deletar um Epic apaga todas as Stories, Tasks e Subtasks vinculadas.

**Identificadores semânticos herdados do pai**
Os identificadores semânticos (N1, P1, E1, etc.) de um card filho são herdados do card pai.
Isso garante rastreabilidade completa da hierarquia e consistência nos prompts gerados para IA.

---

## Geração e Ativação de Cards

**Epic ativa e gera 15–20 Stories**
Ao ativar um Epic sugerido, o sistema automaticamente gera de 15 a 20 Stories em modo rascunho.
As Stories são criadas com label "suggested" e workflow_state="draft", aguardando aprovação do usuário.

**Story ativa e gera 5–8 Tasks**
A ativação de uma Story desencadeia a geração automática de 5 a 8 Tasks filhas em rascunho.
O sistema usa o contexto semântico da Story para criar Tasks coerentes e relevantes.

**Task ativa e gera 3–5 Subtasks**
Ativar uma Task gera automaticamente entre 3 e 5 Subtasks filhas com status de rascunho.
Subtasks geradas incluem detalhes operacionais extraídos do contexto da Task pai.

**Subtask ativa, mas não gera filhos**
A ativação de uma Subtask gera seu conteúdo completo (descrição, critérios, prompt), mas não cria filhos.
Subtask é nó folha e seu conteúdo é gerado usando a Metodologia de Referências Semânticas.

**Cards sugeridos não podem gerar filhos**
Um card com label "suggested" e workflow_state="draft" não pode gerar filhos enquanto nesse estado.
Somente após o usuário aprovar (ativar) o card é que a geração de filhos é desbloqueada.

**Ativação muda workflow_state para "open"**
Ao ativar um card sugerido, seu workflow_state muda de "draft" para "open" e o label "suggested" é removido.
Somente cards "open" aparecem como itens plenos do backlog e podem ser movidos no Kanban.

---

## Contexto do Projeto

**Contexto travado após primeira ativação de Epic**
O contexto do projeto (context_semantic e context_human) é travado permanentemente quando o primeiro Epic é ativado.
Após o travamento (context_locked=true), esses campos não podem ser alterados de nenhuma forma.

**context_locked é irreversível**
O campo context_locked só pode ser alterado de false para true — nunca o contrário.
Essa imutabilidade garante que o contexto base do projeto permaneça estável durante todo o ciclo de vida.

**code_path é obrigatório e imutável**
O caminho da pasta de código (code_path) deve ser definido na criação do projeto e nunca pode ser alterado.
O campo aponta para um diretório existente no filesystem e é a base de toda análise do codebase.

**Projeto só existe após o wizard completo**
O projeto só é considerado criado se o wizard de configuração for concluído integralmente.
Abandono da página (fechar aba, navegar, refresh) durante o wizard dispara deleção automática do projeto incompleto.

**Projeto em "processing" não pode ser editado**
Enquanto o pipeline de criação do projeto está em execução (status=processing), o usuário não pode editar seus dados.
O projeto só se torna editável após atingir o status "active", com o pipeline concluído.

**Deleção de projeto apaga tudo em cascata**
Deletar um projeto remove automaticamente todas as entidades vinculadas: tasks, interviews, prompts, wiki_pages e commits.
Não existe deleção parcial — o projeto é uma unidade atômica para fins de remoção.

---

## Entrevista de Contexto

**Entrevista de contexto tem mínimo de 3 perguntas fixas**
As perguntas Q1 (nome do produto), Q2 (propósito e features) e Q3 (arquitetura técnica) são obrigatórias.
Sem essas 3 respostas, o sistema não permite gerar o contexto do projeto.

**Entrevista de contexto é ilimitada**
Após as 3 perguntas fixas, a IA gera perguntas contextuais adicionais (Q4+) sem limite de quantidade.
O usuário decide quando encerrar, clicando em "Gerar Contexto" — não há número máximo de perguntas.

**Perguntas da entrevista são fechadas com 5–8 opções**
Todas as perguntas da entrevista são de múltipla escolha, com entre 5 e 8 opções de resposta pré-definidas.
Esse formato garante consistência nas respostas e facilita a geração de contexto estruturado pela IA.

**Entrevista focada em card requer parent_task_id**
O modo "task_focused" de entrevista exige que um parent_task_id seja informado.
Nesse modo, a entrevista gera sugestões de Subtasks para a Task pai e não trava o contexto do projeto.

**Deleção de task apaga entrevistas vinculadas**
Ao deletar uma Task, todas as entrevistas que foram criadas a partir dela são deletadas em cascata.
O inverso não é verdade: deletar uma entrevista não exclui as tasks que foram geradas a partir dela.

**Contexto já travado bloqueia nova entrevista**
Se context_locked=true, o sistema redireciona o usuário ao tentar iniciar uma nova entrevista de contexto.
Uma vez que o contexto está travado, não é possível modificá-lo via entrevista ou qualquer outro meio.

---

## Supremacia do Dado Humano (REGRA #0)

**IA nunca sobrescreve dados editados por humano**
Qualquer campo marcado como "human" (description_edited_by="human") é protegido contra sobrescrita pela IA.
Essa é a REGRA #0 do sistema — tem precedência sobre todas as demais regras de geração de conteúdo.

**Campos rastreiam quem foi o último editor**
Os campos description_edited_by e prompt_edited_by registram se o último editor foi "ai" ou "human".
Quando o usuário edita manualmente um campo, o sistema automaticamente marca como "human", ativando a proteção.

---

## Sistema de Bloqueio de Modificações

**Modificação da IA com >90% de similaridade bloqueia o card**
Quando a IA sugere alterar um card existente com similaridade semântica acima de 90%, o card entra em status BLOCKED.
A modificação proposta é salva em pending_modification e aguarda aprovação explícita do usuário via UI.

**Usuário decide aprovar ou rejeitar modificações pendentes**
Cards bloqueados ficam visíveis no endpoint GET /tasks/blocked e na interface, aguardando ação do usuário.
Aprovar aplica a modificação proposta; rejeitar descarta a sugestão e restaura o card ao estado original.

---

## Máquina de Estados por Tipo de Item

**Estados terminais não têm transições de saída**
Estados como "done" (Epic, Story, Task, Subtask) e "closed" (Bug) são terminais — o item não pode mais mudar de estado.
Toda tentativa de transição a partir de um estado terminal é rejeitada pelo WorkflowValidator.

**Workflow do Epic: backlog → planning → in_progress → review → done**
Epics seguem uma sequência de planejamento antes de entrar em execução.
É permitido retornar de in_progress para planning, mas não pular etapas na progressão.

**Workflow da Story: backlog → ready → in_progress → review → validation → done**
Stories incluem um estado intermediário de "validation" antes de serem concluídas.
Do estado "review" é possível ir para validation, done ou voltar para in_progress.

**Workflow da Task: backlog → todo → in_progress → code_review → testing → done**
Tasks têm workflow orientado ao ciclo de desenvolvimento de software (code review e testing).
De code_review é possível ir para testing, done ou retornar para in_progress.

**Workflow do Bug: new → confirmed → in_progress → fixed → verified → closed**
Bugs têm workflow próprio com etapas de confirmação, correção e verificação antes do fechamento.
De "fixed" é possível voltar para in_progress (reabertura) ou avançar para verified ou closed.

**Workflow da Subtask: todo → in_progress → done**
Subtasks possuem o workflow mais simples do sistema, com apenas três estados possíveis.
É permitido voltar de in_progress para todo, mas não há estados intermediários adicionais.

---

## Tipos e Atributos Específicos

**Campo severity é exclusivo de Bugs**
O campo severity (blocker, critical, major, minor, trivial) é nullable e aplicável somente a itens do tipo Bug.
Para outros tipos de item (Epic, Story, Task, Subtask), o campo severity não tem significado e não deve ser preenchido.

**Story Points seguem escala Fibonacci**
Os pontos de esforço estimado (story_points) seguem a sequência Fibonacci: 1, 2, 3, 5, 8, 13, 21.
Embora não haja validação programática estrita, a convenção é adotada por todo o sistema e interfaces.

---

## Sistema de Prioridade de Jobs

**Jobs CRITICAL (10) executam primeiro**
Mensagens de entrevista e chat têm prioridade máxima (10) pois o usuário está aguardando resposta em tempo real.
Esses jobs interrompem a fila e são processados imediatamente, antes de qualquer outro tipo de job.

**Jobs HIGH (7): geração de contexto e wizard**
Jobs de geração de contexto, título do projeto e pipeline completo têm prioridade 7 (alta).
São acionados durante o wizard de criação, onde o usuário aguarda o resultado para continuar.

**Jobs NORMAL (5): ações do usuário que podem aguardar**
Memory scan, geração de commits, execução de tasks e geração de epics têm prioridade 5.
São disparados pelo usuário, mas não exigem resposta imediata — o usuário pode continuar navegando.

**Jobs LOW (3): geração em background**
Ativações de cards, geração de filhos, RAG contínuo e enrichment de wiki têm prioridade 3.
São executados em background sem bloqueio ao usuário, sempre após os jobs de maior prioridade.

**Dentro da mesma prioridade, ordem FIFO**
Quando dois jobs têm a mesma prioridade, o que foi criado primeiro é executado primeiro (FIFO).
Isso garante equidade no processamento de operações de mesma importância e evita starvation.

---

## Fila de Execução (Prompt Queue)

**Posição na fila considera 5 fatores de score**
A posição de um item na fila é calculada combinando: prioridade do card, nível hierárquico, idade, dependências e override manual.
O item na posição 1 é executado primeiro; a fila é reordenada automaticamente ao adicionar novos itens.

**Itens com dependências não resolvidas ficam bloqueados**
Um item da fila não pode ser executado se possuir dependências (depends_on) ainda não concluídas.
O item permanece com status BLOCKED na fila até que todas as dependências atinjam o estado COMPLETED.

**Override manual prevalece sobre score automático**
Quando o usuário reordena manualmente a fila (drag-and-drop), o campo manual_override é marcado como true.
A posição definida pelo usuário tem precedência sobre qualquer recálculo automático de score.

---

## RAG e Scan Contínuo

**Scan contínuo só inicia após scan inicial completo**
O scheduler de RAG contínuo só processa projetos onde initial_scan_complete=true.
Isso evita conflitos entre o scan inicial e os incrementais, garantindo que a base completa seja indexada primeiro.

**Ordem de processamento: SCHEMA → ROUTES → LOGIC → PRESENTATION → CONFIG**
Os arquivos do codebase são analisados nessa ordem semântica para garantir que dependências sejam entendidas antes dos consumidores.
Por exemplo, modelos de banco são indexados antes de services, que dependem dos modelos para serem compreendidos.

**Arquivo deletado tem registros removidos do RAG**
Quando um arquivo é detectado como deletado do disco, seu status muda para DELETED e suas regras são removidas do RAG.
A linha de controle do arquivo (RAGFileState) também é excluída após a limpeza do RAG.

**Padrões de ignore vêm de dois sources: IA e usuário**
O pré-scan de IA detecta automaticamente padrões de arquivos a ignorar (custom_ignore_patterns).
O usuário também pode definir manualmente caminhos a ignorar (ignore_paths) via interface, e ambos são respeitados.

---

## AI Flow Chains (Fallback de Modelos)

**Cada usage_type tem exatamente uma chain ativa**
Para cada tipo de operação de IA (interview, memory, task_execution, etc.), existe exatamente uma chain ativa configurada.
Não é possível ter duas chains ativas para o mesmo usage_type — uma nova chain desativa a anterior.

**Chain é percorrida em ordem com fallback automático**
Se o modelo 1 da chain falhar (timeout, erro, rate limit), o sistema tenta automaticamente o modelo 2, depois o 3.
Se todos os modelos da chain falharem, o erro é retornado ao chamador sem retry adicional.

**Qwen3 é priorizado para outputs verbosos em português**
Nas chains que demandam respostas longas ou em português (memory, queue_orchestration, general), Qwen3 é o modelo primário.
Essa preferência é configurável e reflete o comportamento atual do preset "Custo Mínimo" com modelos locais.

**API keys de modelos ficam no banco, nunca no .env**
As chaves de API dos modelos de IA são armazenadas exclusivamente na tabela ai_models do banco de dados.
O arquivo .env não contém chaves de API de modelos — o usuário as configura pela interface web em /ai-models.

---

## Cache Redis Multi-Nível

**L1 — cache por hash exato com TTL de 7 dias**
O primeiro nível de cache armazena respostas de prompts idênticos, identificados por hash exato do conteúdo.
Com taxa de acerto esperada de ~20%, o TTL é de 7 dias — hits nesse nível evitam completamente a chamada à IA.

**L2 — cache semântico com similaridade >95% e TTL de 1 dia**
O segundo nível usa busca semântica para encontrar prompts similares (similaridade acima de 95%).
Com taxa de acerto de ~10% e TTL de 1 dia, responde prompts semanticamente equivalentes sem chamar a IA.

**L3 — cache de template para prompts determinísticos com TTL de 30 dias**
O terceiro nível armazena respostas de prompts com temperatura=0, que sempre produzem o mesmo output.
Com TTL de 30 dias e taxa de acerto de ~5%, é ideal para prompts estruturais e de geração de código repetitivo.

**Cache gera economia estimada de 60–90% em tokens**
A combinação dos três níveis resulta em taxa de acerto total de 30–35% das requisições de IA.
Isso se traduz em uma economia estimada de 60 a 90% no custo de tokens, especialmente em projetos com prompts recorrentes.

---

## Rate Limiting e Concorrência

**Rate limit configurável por modelo de IA**
Cada modelo pode ter um limite de requisições por janela de tempo (rate_limit_requests / rate_limit_window_seconds).
Valores NULL significam sem limite. O rate limiter registra o uso ANTES da chamada para evitar estouros.

**Timeout configurável por modelo**
Cada modelo pode ter um timeout específico em segundos para chamadas de API (timeout_seconds).
Se o campo for NULL, o sistema usa o timeout padrão definido nas configurações globais (SystemSettings).

**Limite de requisições simultâneas por modelo**
O campo max_concurrent_requests limita o número de chamadas paralelas ao mesmo modelo de IA.
Valor NULL significa sem limite de concorrência. Essa regra protege modelos locais (Ollama) de sobrecarga.

---

## Specs e Redução de Tokens

**Specs de escopo "framework" são globais entre projetos**
Specs com scope="framework" contêm conhecimento sobre tecnologias (ex: Laravel, Next.js) e são reutilizadas por todos os projetos.
Já specs com scope="project" são exclusivas de um projeto e não são compartilhadas entre projetos distintos.

**Specs reduzem tokens em 70–85%**
A injeção de specs na geração de prompts reduz 60–80% dos tokens na geração e 15–20% adicionais na execução.
Essa otimização é crítica para reduzir custos operacionais com modelos cloud e melhorar a velocidade de resposta.

---

## Proteção e Deleção

**Projetos podem ser marcados como protegidos**
O campo protected=true impede que um projeto seja deletado acidentalmente via API ou interface.
Para deletar um projeto protegido, é necessário desativar a proteção explicitamente antes — não existe bypass direto.

---

## Complexidade e Seleção de Modelo

**Complexidade do card determina o modelo de IA usado**
Cards com complexity="low" usam o modelo Haiku (rápido e barato), "medium" usam Sonnet (balanceado) e "high" usam Opus (poderoso).
Essa regra otimiza custo e velocidade: tarefas simples não consomem modelos caros desnecessariamente.

**Token budget e tokens reais são rastreados por card**
Cada card registra o orçamento de tokens previsto (token_budget) e os tokens efetivamente consumidos (actual_tokens_used).
Essa comparação alimenta a otimização contínua de custo e permite alertas quando o real supera o orçado.

---

## Metodologia de Referências Semânticas

**Prompts usam identificadores simbólicos imutáveis**
O sistema usa identificadores como N1, P1, E1, D1, S1, C1, AC1 para referenciar entidades do domínio nos prompts.
Esses identificadores têm significado imutável e são reutilizados de forma consistente de Epics até Subtasks.

**Saída dual: description (humana) + generated_prompt (semântica)**
Cada card possui dois campos de conteúdo: description (texto legível para humanos) e generated_prompt (texto com identificadores semânticos para IA).
Os identificadores semânticos são convertidos para texto humano via _convert_semantic_to_human() sem chamadas adicionais à IA.

---

## Wiki do Projeto

**Páginas de regras devem ser filhas de "regras-de-negocio"**
Qualquer página com slug iniciado em "regra-*" deve ter parent_id apontando para a página "regras-de-negocio".
Se essa página pai não existir, o sistema a cria automaticamente como stub antes de criar a regra filha.

**Wiki é gerada automaticamente no pipeline de criação**
Durante o pipeline de criação do projeto, o sistema gera automaticamente as seções base da wiki.
As seções geradas incluem: Visão Geral, Stack Tecnológica, Arquitetura, Features, Regras de Negócio e Integrações.

---

## Externalização de Prompts e Contratos

**Todos os prompts devem estar em arquivos YAML**
É proibido ter prompts embutidos diretamente no código — todos devem residir em arquivos YAML na pasta backend/app/prompts/.
Os prompts são carregados via PromptLoader e integrados ao sistema pelo PromptService + AIOrchestrator.

**Regras de negócio são governadas por contratos YAML**
As 70 definições de contrato em YAML (business, generation, interviews, memory, execution) definem o comportamento esperado do sistema.
Os contratos são a fonte de verdade para validações, contagens de geração e regras de workflow — o código implementa os contratos.

---

## Ciclo de Vida do Projeto

**Status do projeto segue draft → processing → active**
Um projeto começa como "draft" (criado, pipeline não iniciado), passa para "processing" (pipeline rodando) e chega em "active" (pronto para uso).
Não existe transição retroativa — um projeto ativo não pode voltar para processing ou draft.

**Projeto se torna "active" quando primeiro Epic é aprovado**
O status do projeto muda de "draft" para "active" quando pelo menos um Epic é aprovado ou criado manualmente.
Esse evento também dispara o travamento do contexto e sinaliza que o backlog inicial está pronto para uso.

---

## Validações de Criação de Cards

**Projeto deve existir ao criar uma Task**
A criação de qualquer card (Epic, Story, Task, Bug, Subtask) exige que o project_id fornecido corresponda a um projeto existente.
Se o projeto não for encontrado, a requisição é rejeitada com erro de validação antes de qualquer processamento.

**Parent deve existir e ser do tipo correto**
Se parent_id for informado ao criar um card, o item pai deve existir e ser de um tipo compatível com a hierarquia.
Combinações inválidas (ex: Subtask como pai de uma Story) são rejeitadas na validação de criação.

---

## Atribuição e Criação de Cards

**Reporter padrão é "system"**
O campo reporter (quem reportou o card) assume o valor padrão "system" quando não é informado explicitamente.
Outros valores válidos incluem "ai" (gerado automaticamente) e "watchdog" (gerado pelo monitoramento em background).

**Assignee é opcional em todos os cards**
O campo assignee (responsável pelo card) é nullable em todos os tipos de item do backlog.
Cards sem assignee são válidos e comuns, especialmente em cards gerados automaticamente pela IA.

---

## Memory Scan do Codebase

**Scan prioriza docs > config > migrations > models > services**
A ordem de leitura dos arquivos durante o memory scan segue uma hierarquia semântica de importância.
Documentação e configurações são lidas primeiro para estabelecer contexto antes de analisar código de serviços.

**Scan ocorre em 4 fases: Documentação → Domínio → Lógica → Consolidação**
O scan de memória é dividido em fases para construir progressivamente o entendimento do codebase.
Na fase de Consolidação, o sistema integra todos os insights das fases anteriores em um contexto único e coerente.

---

## Relacionamentos entre Cards

**Cards podem ter relacionamentos do tipo JIRA**
O sistema suporta relacionamentos entre cards: blocks, depends_on, relates_to, duplicates e clones.
Relacionamentos do tipo "depends_on" são respeitados pela Prompt Queue, que bloqueia execução de dependentes não resolvidos.

---

## Comentários de Cards

**Comentários têm 3 tipos: usuário, sistema e IA**
O tipo "comment" é para mensagens do usuário; "system" é gerado automaticamente por eventos do sistema; "ai_generated" é criado pela IA.
Comentários são deletados em cascata quando o card é deletado e são ordenados por data de criação (DESC).

---

## Watchdog e Limites de Geração

**Máximo de 10 cards gerados por ciclo do watchdog**
O watchdog (processo de geração em background) está limitado a criar no máximo 10 cards por ciclo de execução.
Esse limite foi aumentado de 5 para 10 (PROMPT #228) para acelerar o preenchimento inicial do backlog.

**Máximo de 2 cards enriquecidos por ciclo idle**
Quando o sistema está ocioso, o watchdog pode enriquecer até 2 cards por ciclo (adicionar detalhes, contexto, critérios de aceite).
Esse limite evita que o enriquecimento em background consuma recursos excessivos durante períodos de baixa atividade.

---

## Rastreabilidade e Auditoria

**Batch source rastreia qual batch criou o card**
O campo batch_source registra informações do lote que criou ou modificou o card (batch_number, files_processed, layer).
Essa rastreabilidade permite auditoria completa da origem de cada card gerado por processamento em batch.

**Todas as transições de status são registradas**
O histórico completo de mudanças de status de cada card é mantido na entidade StatusTransition.
Essas transições são deletadas em cascata com o card e servem como trilha de auditoria do ciclo de vida do item.

**Insights das entrevistas são preservados nos cards**
Os campos interview_insights e interview_question_ids rastreiam quais perguntas e respostas originaram cada card.
Isso garante rastreabilidade bidirecional: do card de volta à entrevista que o gerou, e da entrevista para os cards criados.

---

*86 regras documentadas — gerado a partir de BUSINESS_RULES_EXTRACTION.md e ORBIT_REPORT.md*