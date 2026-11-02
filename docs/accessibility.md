# Acessibilidade da interface

## Diálogos modais

O componente `Modal` em `apps/web/components/ui.tsx` implementa foco inicial, contenção de `Tab`/`Shift+Tab`, fechamento por Escape, empilhamento de diálogos e restauração do foco anterior. Use-o para conteúdo modal em vez de criar `role="dialog"` isolado.

Os visualizadores de imagem de descrições Markdown e comentários usam esse componente e preservam a alternativa textual da imagem ampliada. O Suindá mantém a mesma interação e o tema escuro próprio de seu produto.

ESLint, TypeScript e builds de produção dos front ends Orbit DEV e Suindá passaram após a integração. O repositório não tem harness de interação React/jsdom e Selenium está desautorizado neste host; leitores de tela e fluxos reais de teclado ainda exigem validação assistiva em ambiente apropriado.

O campo de busca global do painel principal tem nome acessível explícito (`aria-label`); placeholder sozinho não identifica o controle para tecnologia assistiva. A rota dinâmica de autenticação anuncia “Link de autenticação inválido” como título principal quando recebe um modo/token não aceito. As mudanças equivalentes foram aplicadas no Orbit DEV e na branch Suindá; ambos os builds Web passaram e a auditoria autenticada sintética do Suindá passou nas 76 combinações de rota/viewport. Essa última não autentica contra a API nem substitui testes com conta real ou leitor de tela.

## Selo de notificações não lidas

A contagem exibida no selo vermelho do cabeçalho compartilhado usa `#d32f2f` com texto branco. A verificação autenticada sintética de contraste encontrou o valor anterior `#e5484d` em 3,91:1; `#d32f2f` passou a 4,98:1 no estado com uma notificação não lida. A correção é aplicada no core Orbit DEV e na branch derivada Suindá. A validação no navegador percorreu 38 rotas em desktop e celular; no dashboard, o painel foi aberto para incluir o conteúdo da notificação, sem violações de contraste textual/não textual, falhas de hover/foco ou amostras não resolvidas. A fixture usou dados sintéticos; a medição cobre 1.4.3/1.4.11 e não declara conformidade WCAG completa.
