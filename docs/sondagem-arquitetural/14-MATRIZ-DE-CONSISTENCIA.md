# Matriz de consistência

Classificações refletem evidência estática no runtime DEV, não resultado de testes. **Existente** indica mecanismo concreto no escopo descrito; **parcial** indica cobertura limitada; **ausente de evidências** indica que não foi localizado; **não verificável** exige teste ou leitura adicional.

| Dimensão | Estado | Evidência | Limite/risco |
|---|---|---|---|
| Consistência local da tarefa | Parcial | Write scope compara árvore antes/depois e restaura alterações externas ao escopo; checks configurados podem reverter alterações em falha (`execution/file-scope.ts:11-59`; `execution.service.ts:118-133`) | Não isola writers concorrentes; execução de prompt e execução genérica têm caminhos próprios |
| Card ↔ execução | Parcial | Prompt/run persistidos e entrada snapshot; status e artefatos rastreáveis (`schema.sql:426-450`; `run-repository.ts:10-18`) | Sem revisão do card; edição pode deixar execução obsoleta (`main.ts:953-963`; `prompt-sessions.ts:469-517`) |
| Consistência entre cards | Ausente de evidências | Fila FIFO/claim e locks por projeto no prompt | Sem DAG/invalidação semântica de dependências entre cards; `chain` não teve consumidor identificado |
| Consistência de regras de negócio | Parcial | Arquitetura Orbit/skills/contexto e checks de projeto entregues ao executor | Checks são comandos, não reconciliação semântica de regras distribuídas (`context-builder.ts:11-51`; `execution.service.ts:118-133`) |
| Consistência de versões | Parcial | `updated_at`, prompt salvo, IDs de sessão, hash de alguns recursos, SHA de commit associado | Sem revisão formal de card, pin de HEAD por run ou versão global do contexto (`schema.sql:103-114,426-450`; `project-registry.ts:26-107`) |
| Consistência entre agentes | Parcial | Flag multiagente e instruções sobre delegação mínima; locks do subsistema prompt por card/projeto | Não foi encontrado protocolo de consenso/reconciliação entre subagentes; worktree compartilhado e integração permanecem responsabilidade do Codex integrador (`prompt-sessions.ts:467,490-507`) |
| Concorrência de execução | Parcial | DB claim com `SKIP LOCKED`; locks advisory em prompt subsystem; poller local (`run-repository.ts:10-18`; `prompt-sessions.ts:490-507`; `execution.service.ts:35-38`) | Filas/subsistemas não demonstraram lock comum; diretório compartilhado não isolado |
| Consistência durante integração | Parcial | Revisão de diff/ETag, stage seletivo, validação exata de arquivos esperados ao commit (`git.plugin.ts:145-199`) | Aplicável ao fluxo Git explícito; não bloqueia qualquer commit externo nem revalida semântica entre cards |
| Consistência após rollback | Parcial | Undo/redo cria commit revert e registra ação/alvo (`git.plugin.ts:201-216`; `schema.sql:573-582`) | Requer branch original e worktree limpo; conflito/dependências posteriores podem impedir ou comprometer resultado |
| Exclusão administrativa vs rollback | Existente como distinção operacional | Arquivar/restaurar só altera estado do card; rollback é fluxo Git separado (`main.ts:668-682`; `git.plugin.ts:201-216`) | Hard delete apaga associações via cascata (`schema.sql:562-565`) e não desfaz código |
| Comunicação de progresso | Existente | JSONL CLI, persistência e evento realtime (`codex-provider.ts:72-94,172-216`; `prompt-sessions.ts:520-568`) | Eventos não equivalem a estado desejado reconciliado |
| Comunicação bidirecional com ferramentas Orbit | Ausente de evidências | Há pergunta humana limitada por marcador e REST | Não foi localizado RPC/bridge genérico de ferramenta/consulta (`prompt-sessions.ts:538-546`; `execution/codex-executor.ts:26-34`) |
| Memória e conhecimento versionado | Parcial | BM25 com hash/stale e retrieval vetorial com escopo/candidatos autorizados | Sem proveniência por revisão/HEAD; ligação automática a cada run não confirmada (`knowledge.mjs:181-235`; `knowledge-retrieval.ts:35-93`) |

## Leitura geral

Orbit já dispõe de controles úteis de escopo, checks, persistência de execução, progresso, revisão Git e revert. O conjunto não garante sozinho consistência global para cards editáveis e execução paralela. A lacuna estruturante mais clara é ligar cada execução à revisão do card, contexto compilado e estado do projeto, e então decidir como detectar/reter ou invalidar resultado quando algum desses elementos muda.
