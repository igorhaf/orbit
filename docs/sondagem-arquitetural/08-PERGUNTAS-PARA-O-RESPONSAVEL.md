# Perguntas para o responsável pelo projeto

Questionário restrito a decisões de intenção e operação que não podem ser deduzidas com segurança do código.

## Agentes e delegação

1. Agentes devem ser cadastrados globalmente, por workspace, por projeto, por cartão ou em mais de um desses níveis?
2. A caixa “Múltiplos agentes” deve significar “permitir delegação nativa” ou “a execução precisa realmente delegar e mostrar os agentes usados”?
3. Quais informações de subagentes precisam aparecer no Orbit: papéis, prompts, arquivos alterados, custos, progresso, erros e respostas entre agentes?
4. Que ações os agentes podem realizar sem aprovação e quais devem parar para aprovação humana?

## Fila e continuidade

5. O que o usuário espera quando uma execução fica stale ou falha: retry automático, reexecução manual, retomar sessão ou revisão humana obrigatória?
6. Execuções Codex que já estão rodando devem poder ser canceladas pela interface? Há exigência de encerrar processos-filho e limpar sessões?
7. Deve haver prioridade por projeto, cartão, usuário, urgência ou ordem de chegada? Quais limites de paralelismo são esperados?
8. A cadeia `card_runs.chain` é um conceito pretendido para dependências de tarefa ou não deve ter semântica de produto?

## Histórico, contexto e RAG

9. É necessário restaurar qualquer edição de cartão para uma revisão anterior? Que conteúdo e anexos entram no snapshot e por quanto tempo?
10. Qual é a fonte de verdade quando memória, documentação local, histórico de cards e contexto recuperado divergem?
11. Recuperação vetorial deve ser automática em prompts de cartão ou opt-in por projeto/plugin? O usuário precisa ver/editar os trechos incluídos?
12. Quais limites de retenção e isolamento devem valer para conversas, embeddings, arquivos de saída e estado de agentes?

## Versionamento e operação

13. Qual sequência desejada para branch/tag, integração DEV, promoção a PROD e rollback?
14. Que ações de Git, deploy, migração e recuperação sempre exigem aprovação de uma pessoa?
15. Qual interface CONTROL é a referência operacional atual para todos os quatro runtimes?
16. Que combinações de plugins e versões fazem parte da matriz de compatibilidade oficialmente garantida?

As questões sobre código presente, schema, APIs e chamadas estão nos relatórios 02–07 e não são repetidas aqui.
