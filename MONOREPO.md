# Consolidação do repositório Orbit

## Marco inicial

Em 10/11/2026, o diretório `/home/meada/projetos/orbit` passou a ser o repositório Git único, na branch `main`. Os checkouts locais anteriores foram consolidados como conteúdo da árvore atual:

- `dev/app` — runtime Orbit DEV;
- `prod/app` — runtime Orbit PROD;
- `safdoulas-v2/app` — runtime Safdoulas;
- `suinda/app` — runtime Suindá.

Os diretórios de aplicação foram mantidos para preservar caminhos usados pelos Compose, volumes e quadros. Portanto, o primeiro marco é uma consolidação de repositório, não uma extração completa do código compartilhado: versões de core ainda podem divergir entre esses caminhos. Mudanças comuns devem ser integradas e verificadas nos runtimes afetados até a extração dos módulos compartilhados.

## Preservação dos repositórios anteriores

Antes da consolidação, os quatro repositórios Git locais foram arquivados sob `control/backups/monorepo-migration-2026-11-10/`:

- `git-bundles/` preserva objetos e refs locais dos repositórios anteriores;
- `nested-git-metadata/` guarda cópias dos metadados `.git` originais;
- `working-diffs/` preserva as alterações rastreadas que ainda não tinham commit.

Esse diretório está ignorado pelo Git e não entra no monorepo. Os arquivos de trabalho atuais continuam na árvore e foram selecionados para o snapshot inicial, exceto dados locais e artefatos gerados. Os bundles não criam branches antigas no novo repositório.

## Exclusões do monorepo

Não são versionados: `.env` reais, credenciais, bancos e arquivos sob `data/`, backups, sessões, `node_modules`, caches/builds do Next.js, caches de agentes e estado operacional do CONTROL. Modelos de configuração sem segredos e código de operação são mantidos. A lista de exceções de exemplos de Suindá está em `.gitignore`.

## Commit e tag de referência

O commit raiz do repositório registra a árvore consolidada na branch `main`. A tag anotada `orbit-monorepo-baseline-2026-11-10` aponta para o snapshot que reúne os quatro runtimes e as alterações locais de código selecionadas. Ela não representa deploy nem validação funcional.

## Próxima etapa arquitetural

A consolidação Git elimina a necessidade de sincronizar branches, mas ainda não elimina cópias de código. A evolução recomendada é identificar contratos comuns, extrair core e plugins Orbit para unidades compartilhadas e fazer cada produto declarar apenas perfil/configuração e plugins exclusivos. Cada mudança deve preservar o isolamento de deploy e banco por ambiente.
