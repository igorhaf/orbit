# Análise dos sete cenários

## Limites

Análise estática do código DEV. Componentes e linhas são evidências observadas; risco é inferência, salvo quando descrito diretamente pelo fluxo. Testes de runtime não foram executados.

## A — Atualização de card não executado

- **Comprovado:** `updateCard` edita a mesma linha e atualiza `updated_at` (`forge/app/apps/api/src/main.ts:881-963`). Prompt de IA lê o card, compõe e armazena prompt antes de inserir a execução (`forge/app/apps/api/src/plugins/ai/prompt-sessions.ts:413-485`). A fila `card_runs` guarda `input` com card/config (`forge/app/apps/api/src/execution/run-repository.ts:10-18`).
- **Comportamento:** o prompt enfileirado não é regenerado quando o texto do card muda. Na execução genérica, o snapshot de `input` é usado ao processar (`execution.service.ts:104-115`).
- **Não encontrado:** revisão do card, invalidação de run antigo ou verificação de frescor no claim.
- **Risco/inferência:** execução agendada pode atender texto obsoleto, embora o card atual mostre outra intenção.
- **Teste necessário:** editar após enqueue e antes do início nos dois sistemas de fila; confirmar se bloqueia, cancela ou executa snapshot.

## B — Atualização durante execução

- **Comprovado:** card muda em linha, sem revisão; o worker de prompt conserva contexto carregado antes do enqueue e constrói a execução a partir dele (`prompt-sessions.ts:469-517`). Ao finalizar, grava sucesso e saída sem comparar versão atual (`:549-568`).
- **Não encontrado:** redirecionamento da sessão, detecção de mudança textual ou rejeição de resultado obsoleto.
- **Risco/inferência:** conclusão antiga pode ser apresentada como concluída para um card já alterado.
- **Teste necessário:** editar durante execução controlada; inspecionar run, resultado, alerta ao usuário e possibilidade de integração.

## C — Atualização após integração

- **Comprovado:** a continuação retoma session ID no mesmo card/projeto e recebe orientação para conferir arquivos atuais e tratar a descrição atual como requisito (`prompt-sessions.ts:447-471,506-507`). Run guarda arquivos alterados; Git associa commit ao card quando commit é feito pelo fluxo Orbit (`schema.sql:439-440,562-582`; `git.plugin.ts:189-199`).
- **Parcial:** `commitDraft` correlaciona alterações sujas com arquivos registrados por execuções recentes, heurística sujeita a sobreposição (`git.plugin.ts:109-120`).
- **Não encontrado:** índice semântico de implementação ligado ao card, criação/alteração classificada por diff semântico, revisão/HEAD pinado ou RAG obrigatório no início.
- **Risco/inferência:** há meios de retomar trabalho e inspecionar arquivos, mas não garantia de reconhecer tudo que já foi implementado nem de evitar reconstrução.
- **Teste necessário:** executar, integrar, alterar o card e retomar após mudanças próprias e externas; confirmar diffs e associação.

## D — Cards concorrentes

- **Comprovado:** `card_runs` usa claim com `FOR UPDATE SKIP LOCKED`; o serviço tem poller local e impede concorrência dentro da instância (`run-repository.ts:10-18`; `execution.service.ts:35-38,143-149`). Prompt sessions usam advisory locks por card e projeto (`prompt-sessions.ts:490-507`). Execuções respeitam write scope e verificações (`execution.service.ts:118-133`; `codex-provider.ts:51-69`).
- **Parcial:** essas proteções atuam em escopo próprio. Não foi encontrado lock compartilhado entre fila genérica, prompt, ações Git e edição humana, nem worktree por execução.
- **Não encontrado:** detector de conflito semântico entre cards ou revalidação global no momento de integração.
- **Risco/inferência:** snapshot/restore de write scope pode classificar alteração alheia como pertencente ao run se compartilharem diretório; restauração pode afetar escritor concorrente (`execution/file-scope.ts:36-59`).
- **Teste necessário:** duas execuções em processos separados, mesmos/arquivos distintos, check falhando e commit concorrente; verificar isolamento e atribuição.

## E — Independência da fila

- **Comprovado:** filas fazem agendamento/claim e prevenção limitada de duplicidade; catálogo e dependências de plugins não representam dependências entre cards (`run-repository.ts:10-18`; `orbit.workspace.json` e registries são escopo de plugin/produto).
- **Não encontrado:** DAG de cards, inferência de componente compartilhado, invalidadores de premissas ou sincronização de contexto ao concluir cada run. `card_runs.chain` aparece no modelo, mas seu uso não foi localizado.
- **Risco/inferência:** ordem de escrita/conclusão pode mudar resultado quando tarefas se sobrepõem, mesmo que ambas pareçam independentes.
- **Teste necessário:** três cards com requisito funcional comum em ordens distintas e comparar integração/estado final.

## F — Contexto/memória desatualizados

- **Comprovado:** prompt coleta card, checklist, comentários, contexto vinculado, skills, escopo e checks (`prompt-sessions.ts:426-471`). Registrador de projeto lê documentos e calcula hashes (`project-registry.ts:26-107`). BM25 detecta fonte local desatualizada; recuperação vetorial usa candidatos autorizados fornecidos pelo chamador (`tools/orbit/knowledge.mjs:181-235`; `knowledge-retrieval.ts:35-93`).
- **Parcial:** não foi achado vínculo dos vetores a SHA do projeto/revisão do card, nem RAG ligado como pré-condição geral. Continuação de sessão pode preservar histórico antigo.
- **Não encontrado:** reconciliação automática entre instrução, documentação, card e código vivo.
- **Risco/inferência:** instrução histórica na sessão ou documento antigo pode competir com estado atual; orientação de inspecionar arquivos reduz, mas não prova invalidação.
- **Teste necessário:** mudar fonte depois de indexar/continuar sessão; confirmar detecção, exclusão de contexto obsoleto e apresentação de proveniência.

## G — Exclusão e rollback

- **Comprovado:** arquivar marca timestamp e restaurar limpa a marca, sem mexer no código (`main.ts:668-682`). Exclusão definitiva requer arquivamento, cancela queued/waiting e recusa execução ativa (`main.ts:965-986`). FK `git_card_commits.card_id` usa `ON DELETE CASCADE`, então vínculo histórico DB é removido com card (`schema.sql:562-565`), mas commit Git não é apagado.
- **Comprovado:** undo/redo pelo plugin é operação separada, baseada em `git revert`, exigindo branch original, worktree limpo e ancestralidade (`git.plugin.ts:201-216`).
- **Parcial/não verificado:** o rollback pode falhar em conflitos ou não representar dependências semânticas posteriores; teste examina fluxo básico, não todos os cenários reais. Não se demonstrou preservação de associação após hard delete.
- **Teste necessário:** excluir card que tenha commit associado, verificar auditabilidade; reverter commit com commits posteriores dependentes e com conflito.

## Síntese dos cenários

Orbit já registra prompts/resultados, possui execução limitada por escopo, checagens configuráveis e fluxo Git explícito de revisão/commit/revert. A lacuna comum é a falta de identidade imutável que conecte revisão do card, contexto, sessão, base do projeto, alterações e integração; o tratamento consistente entre as duas filas também não foi demonstrado.
