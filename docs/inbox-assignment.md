# Inbox: cartões atribuídos sem mudar o quadro

Arrastar um cartão para Inbox atribui o usuário atual ao cartão e o inclui em seu acompanhamento pessoal. A operação é idempotente: repetir o gesto não remove a atribuição nem cria cópia. Outros responsáveis são preservados.

O comportamento é o mesmo na hierarquia, na lista e no Quadro visual. A gestão estruturada oferece uma alça de arraste; clicar nela também atribui o cartão ao usuário. O alvo compacto Meu Inbox fica disponível em telas pequenas e abre o painel pessoal ao receber o cartão. Os modelos do quadro continuam disponíveis ao alternar de volta à aba Modelos.

O cartão permanece com a mesma lista, posição, pai principal e contextos. Os cartões de registros mantêm seu escopo e seu fluxo formal. Espelhos são resolvidos para o cartão original, sujeito às permissões desse original.

O Inbox reúne os cartões pessoais já existentes e os cartões atribuídos em outros quadros, sem duplicação. Ao abrir um item, o editor carrega seu quadro original, inclusive responsáveis e integrações autorizadas. Só os cartões originalmente criados no Inbox possuem os controles de transferência física para Coleções.

## API e autorização

- `GET /inbox/cards`: lista os cartões atribuídos acessíveis ao usuário; exige `boards.read` e verifica a política do quadro e dos plugins a cada leitura.
- `POST /inbox/cards`: aceita exclusivamente `card_ids`, entre 1 e 20 UUIDs, e exige `boards.write` no quadro de origem; o usuário de destino vem da sessão.
- A operação grava a atribuição, acompanhamento e atividade em uma transação; não atualiza localização ou hierarquia.
- Cartões/quadros arquivados, recursos desativados e acessos revogados não são expostos ou atribuídos.
- Eventos atualizam o quadro de origem e o Inbox do usuário.

## Verificações

O teste `apps/api/src/inbox.integration.spec.ts` usa banco descartável para conferir persistência, idempotência, outros responsáveis, origem, contextos, hierarquia, privacidade e lote inválido sem alteração parcial. A jornada isolada SAFDOULAS cobre também a atribuição de um cartão de processo e a suspensão do plugin base. `apps/web/lib/board-drag.spec.ts` verifica os alvos de arraste e a resolução de espelhos sem abrir navegador.

A conferência visual com mouse e toque permanece pendente de execução manual em ambiente autorizado. Selenium e navegadores automatizados não foram executados no host.
