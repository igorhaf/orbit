# Questionário estratégico

As respostas devem orientar a próxima etapa arquitetural. “Confirmado” descreve apenas código estático do runtime DEV; não presume comportamento de runtime.

## 1. Intenção e revisão de cards

1. **Uma edição de card queued deve substituir o requisito da execução ou criar uma nova revisão/run?** Confirmado: card é atualizado in-place e prompt é composto antes do enqueue (`main.ts:953-963`; `prompt-sessions.ts:469-485`). Decisão: semântica de edição e execução obsoleta.
2. **Durante execução, edição deve interromper, deixar run terminar como revisão antiga ou criar sucessora?** Confirmado: não foi encontrado revision guard nem redirecionamento (`prompt-sessions.ts:486-517,549-568`). Decisão: transição de estado e UX.
3. **Precisamos classificar explicitamente criar, alterar, complementar, corrigir e reverter?** Confirmado: descrição atual e sessão orientam continuidade, sem classificador de tipo de mudança. Decisão: taxonomia e se será sugerida por IA ou escolhida pelo usuário.

## 2. Estado desejado e estado observado

1. **Qual é a fonte de verdade por domínio: card, código, teste, documentação ou combinação ordenada?** Confirmado: builders entregam essas fontes de forma parcial. Decisão: precedência e conflito.
2. **O que significa card concluído: código escrito, checks aprovados, commit, merge ou estado desejado verificado?** Confirmado: sucesso de prompt persiste resultado, commit é ação explícita separada (`prompt-sessions.ts:564-568`; `git.plugin.ts:189-199`). Decisão: critério de conclusão.
3. **Quando uma mudança posterior invalida uma conclusão anterior?** Confirmado: não foi localizado reconciliador de estado desejado. Decisão: regras de validade e reabertura.

## 3. Consistência entre tarefas

1. **Dependências entre cards serão declaradas, inferidas ou ambas?** Confirmado: claim FIFO e nenhuma DAG localizada; `card_runs.chain` sem uso encontrado. Decisão: contrato e autoridade para inferência.
2. **Cards que compartilham arquivos, módulo ou regra podem rodar em paralelo?** Confirmado: existem locks por projeto no prompt e não foi encontrado isolamento por worktree. Decisão: política de serialização/isolamento.
3. **Quem decide conflitos semânticos quando os diffs não colidem?** Confirmado: não foi encontrado motor de consistência entre cards. Decisão: bloqueio, revisão humana ou resolução assistida.

## 4. Atualização de contexto

1. **A execução deve fixar um commit base e uma revisão do card?** Confirmado: esses vínculos não aparecem no schema observado de runs (`schema.sql:426-450`). Decisão: snapshot obrigatório e tratamento de rebase.
2. **Qual fonte pode ser usada como memória: docs vigentes, sessões, commits, cards concluídos, RAG?** Confirmado: todos existem de forma parcial, sem reconciliação única. Decisão: fontes aceitas e hierarquia.
3. **O que fazer com contexto stale ou conflitante: descartar, sinalizar, pedir confirmação ou comparar?** Confirmado: BM25 identifica hashes stale; vetor runtime trabalha com candidatos do chamador. Decisão: política global de validade/proveniência.

## 5. Comunicação entre agentes

1. **Codex precisa apenas responder ao Orbit ou também consultar serviços Orbit durante execução?** Confirmado: saída/eventos e ciclo restrito de pergunta humana; bridge genérica não foi encontrada. Decisão: escopo do protocolo.
2. **Quais ações exigem autorização explícita e quais respostas devem ser estruturadas?** Confirmado: não foi encontrado contrato RPC/ação genérico. Decisão: permissões, idempotência, auditoria e schema.
3. **Descobertas de agentes serão memória durável? Quem valida e define validade?** Confirmado: output/activity são persistidos; descobertas reutilizáveis com proveniência não foram encontradas. Decisão: curadoria e ciclo de vida.

## 6. Concorrência e integração

1. **Qual é o limite de paralelismo: por card, projeto, repositório ou arquivos?** Confirmado: dois mecanismos diferentes de fila/lock. Decisão: unidade e lock compartilhado.
2. **Integração exige checks, revisão humana, comparação com base e compatibilidade de plugins?** Confirmado: Git possui revisão/stage/commit; checks são configuráveis por projeto. Decisão: gate obrigatório e exceções.
3. **Mudança externa durante run deve causar rebase, reexecução ou bloqueio?** Confirmado: não há HEAD pin/revalidation observada. Decisão: política de corrida.

## 7. Rollback e rastreabilidade

1. **Rollback é por commit, card inteiro, revisão ou conjunto de mudanças?** Confirmado: fluxo atual reverte commit individual associado (`git.plugin.ts:201-216`). Decisão: unidade de reversão e seleção de múltiplos commits.
2. **Como manter rastreabilidade técnica após hard delete administrativo?** Confirmado: card deletado remove associação via cascade, commit Git continua (`schema.sql:562-565`). Decisão: retenção/tombstone/auditoria.
3. **Como rollback trata dependências posteriores e efeitos externos?** Confirmado: revert Git pode falhar e exige árvore limpa; sem análise semântica. Decisão: bloqueio, compensação e revisão.

## 8. Limitações e decisões de arquitetura

1. **Qual nível de auditoria e retenção é requerido para prompts, sessões, contexto e saídas?** Confirmado: campos selecionados persistem; transcript completo tipado não foi observado. Decisão: retenção, privacidade e exportabilidade.
2. **O sistema deve privilegiar velocidade, isolamento ou custo quando conflitarem?** Confirmado: multiagente é opção e orientação recomenda delegar só se tempo e tokens totais melhorarem (`prompt-sessions.ts:467`). Decisão: objetivos e métricas.
3. **Quais runtimes precisam compartilhar o contrato e como DEV prova compatibilidade?** Confirmado: regras Orbit indicam DEV como ponto de integração, mas esta investigação de fluxo concentrou-se no DEV. Decisão: escopo de rollout e checks multi-runtime.

## Prioridade sugerida para reunião

1. Definir identidade imutável de execução (revisão do card + base de projeto + contexto).
2. Definir semântica de edição e obsolescência, especialmente queued/running.
3. Definir unidade segura de paralelismo e gate de integração comum às filas.
4. Definir política de validade/proveniência de contexto e memória.
5. Definir rastreabilidade e rollback após exclusão administrativa.
