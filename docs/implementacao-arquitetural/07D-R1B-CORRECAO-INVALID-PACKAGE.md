# 07D-R1B — Correção de invalid-package

R05 resolvido. A publicação selecionada levou `@orbit/core-source` de `1.12.4` para `1.12.5` com 231 mappings em DEV, PROD, Safdoulas e Suindá.

## Causa e correção

A branch era `main` no HEAD `d9307b8e6a54316f802acbd7bcb96baa26116f16`, com 495 entradas preexistentes no status detalhado. O workspace já declarava 231 mappings e o manifesto do pacote declarava 230. Os quatro locks registravam 230. A fonte e as quatro projeções do catálogo tinham o mesmo SHA-256 `a4d1915c2b58679606b556e42c3bf36689e4e04a871b9ef31a4342227c1e60b4`.

A ferramenta usa `sharedPackages[].files` do workspace como referência e exige igualdade por `JSON.stringify` com `orbit.files` do pacote. Cada entrada contém `source` e `target`. A sequência é a declarada no workspace. A única diferença estrutural era a ausência da entrada `src/access/editorial-permissions.ts` → `apps/api/src/access/editorial-permissions.ts`, última no workspace. A validação em `packageSnapshot` rejeitava o pacote e o plano classificava a exceção como `invalid-package`.

O ajuste declarativo inseriu exatamente essa entrada no mesmo índice, com validação do JSON e comparação estrutural antes da gravação. O plano oficial selecionou apenas `@orbit/core-source`, atribuiu o catálogo e o manifesto à execução e propôs um incremento de patch. A checagem intermediária já lia os manifests e indicava a necessidade de incrementar a versão do Core.

## Publicação e arquivos

O plano e a aplicação retornaram sucesso, sem diagnósticos nem caminhos fora do escopo. A aplicação usou a lista exata de caminhos em `--scope` e as precondições da ferramenta oficial. O plano repetido após a aplicação retornou zero escritas.

- `packages/orbit-core/package.json` recebeu a declaração e a versão gerada.
- `orbit.workspace.json` recebeu a versão gerada.
- `{dev,prod,safdoulas,suinda}/app/orbit.shared-lock.json` receberam o registro do Core com 231 entradas.
- Este relatório registra a correção.

## Verificação e limites

Os 21 testes de `tools/orbit/shared.test.mjs` passaram. O snapshot oficial confirmou a igualdade dos manifests. Os 231 hashes de cada runtime correspondem ao snapshot oficial do Core e ao respectivo lock. O hash do catálogo permaneceu idêntico nos cinco arquivos. O diff dos seis arquivos de publicação passou em `git diff --check`. Nenhuma projeção de código precisou de escrita.

O `shared check` global permanece com as mesmas nove divergências históricas da UI, sem diagnósticos do Core e sem locks pendentes. O resultado dirigido do Core passou. As migrations 210 e 211 continuam ausentes das projeções, e Discovery Review, MCP e a ativação de políticas editoriais seguem com os bloqueios vigentes.
