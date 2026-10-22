# Inbox por arraste, sem navegador automatizado

1. Na hierarquia e depois na lista, arrastar a alça de um cartão para a aba Inbox e para seu painel.
2. Conferir atribuição ao usuário atual, permanência na fase e na hierarquia e ausência de cópias.
3. Repetir o gesto e conferir que a atribuição permanece, com os demais responsáveis preservados.
4. Repetir no Quadro visual, incluindo uma seleção de mais de um cartão.
5. No celular, usar o alvo Meu Inbox e a atribuição por clique na alça; conferir o painel e abrir o cartão original.
6. Em quadro de curso, conferir os mesmos resultados e a preservação das transições formais.
7. Revogar acesso ou desativar o plugin de origem e conferir que o cartão desaparece da listagem autorizada.

Testes sem navegador: `apps/web/lib/board-drag.spec.ts`, `apps/api/src/inbox.integration.spec.ts` e jornada isolada SAFDOULAS.

Não executar Selenium ou substituir por outro navegador automatizado neste host: existe restrição expressa do usuário.
