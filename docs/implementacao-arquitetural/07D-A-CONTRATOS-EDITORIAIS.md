# 07D-A — Contratos editoriais do Discovery Review

Implementação limitada à camada determinística. Não adiciona persistência, autorização, API, interface, publicação, RAG, MCP ou integração às filas.

## Contratos e arquivos

- `packages/orbit-core/src/execution/discovery-review.ts`: tipos versionados, validação, transições, CAS, chave idempotente e elegibilidade calculada.
- `packages/orbit-core/src/execution/discovery-review.spec.ts`: nove testes unitários direcionados.
- Nenhuma projeção aos runtimes foi publicada; migrations e arquivos da 07C não foram alterados.

## Máquina de estados

Estados editoriais: `proposed`, `in_review`, `needs_information`, `approved`, `rejected`, `approval_withdrawn`.

| Ação | Estado permitido | Próximo estado |
|---|---|---|
| `start_review` | proposed, needs_information | in_review |
| `request_information` | in_review | needs_information |
| `approve` | in_review | approved |
| `reject` | in_review, needs_information | rejected |
| `withdraw_approval` | approved | approval_withdrawn |

Cada transição válida incrementa `reviewRevision` em um e exige `expectedReviewRevision` igual ao atual. A decisão guarda o par CAS esperado/próximo, autor atribuído, motivo, timestamp, chave idempotente e hash canônico da solicitação. Revisões obsoletas e transições inválidas são recusadas sem mutar o snapshot de entrada.

`reviewerId` é somente atribuição informativa. A camada não autentica identidade nem concede permissão. O host deverá fornecer identidade e autorização efetivas em etapa posterior.

## Invariantes

- Aprovação exige compatibilidade de evidência `compatible` e política compatível; revisão editorial e compatibilidade são dimensões separadas.
- Compatibilidade aceita: `unassessed`, `compatible`, `partially_compatible`, `incompatible`, `unavailable`.
- Elegibilidade é derivada de estado aprovado, compatibilidade e política. Aprovar nunca publica conteúdo; retirar aprovação remove elegibilidade.
- Rejeição e retirada não apagam decisões anteriores. O contrato devolve uma decisão imutável e um novo snapshot; a persistência append-only fica para a fase SQL.
- Repetir a mesma chave com o mesmo comando retorna duplicata; reutilizá-la com conteúdo diferente gera conflito. Chaves distintas ainda obedecem CAS.
- Motivo obrigatório, pedido de informação obrigatório nessa transição, textos limitados e timestamp ISO canônico.
- Estado inicial sempre `proposed`, revisão zero e inelegível.

## Testes

Comando direcionado:

```sh
TSX_TSCONFIG_PATH=forge/app/apps/api/tsconfig.json TSX_DISABLE_CACHE=1 \
  node --import ./forge/app/node_modules/tsx/dist/loader.mjs --test \
  packages/orbit-core/src/execution/discovery-review.spec.ts
```

Resultado final: **9 aprovados, 0 falhas, 0 ignorados**. A primeira execução encontrou que o validador tratava `reviewerId` como UUID; foi corrigido para aceitar um identificador opaco limitado, sem usá-lo como credencial. Reexecutado somente o teste afetado e a suíte direcionada.

## Limitações e decisões para 07D-B/SQL

- Definir esquema append-only de decisões, restrição única de idempotência, política de retenção e comportamento de CAS sob transações concorrentes.
- Resolver duplicata antes de rejeitar CAS obsoleto, mantendo conflito para a mesma chave com solicitação divergente; implementar essa semântica na transação SQL.
- Definir a fonte autorizada de compatibilidade de evidência e como mudanças nessa avaliação afetam elegibilidade sem reescrever decisões editoriais.
- Definir quem pode iniciar, solicitar complementação, aprovar, rejeitar e retirar aprovação, incluindo segregação de funções e reautorização dentro da transação.
- Definir requisitos de revisão mínima e se a retirada exige motivo ou referências complementares. A política atual exige revisão editorial mínima configurável (revisão já existente antes da aprovação) e motivo para todas as decisões.
- O contrato não oferece histórico persistido, auditoria, aprovação humana autenticada, consulta, publicação ou garantia de autorização.

## Estado do trabalho

Branch `main`, HEAD `d9307b8e6a54316f802acbd7bcb96baa26116f16`, preservados. A árvore já continha trabalho não commitado das etapas anteriores; não foi limpa nem reorganizada. Nesta etapa foram criados somente os dois arquivos de implementação/teste desta etapa e este relatório. Sem commit, push, migration, publicação de projeções, serviço ou alteração nas filas. 07D-B não foi iniciada.
