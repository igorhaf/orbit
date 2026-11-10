# Consolidação do repositório Orbit

## Marco inicial

Em 10/11/2026, o diretório `/home/meada/projetos/orbit` passou a ser o repositório Git único, na branch `main`. Os checkouts locais anteriores foram consolidados como conteúdo da árvore atual:

- `dev/app` — runtime Orbit DEV;
- `prod/app` — runtime Orbit PROD;
- `safdoulas/app` — runtime Safdoulas;
- `suinda/app` — runtime Suindá.

Os diretórios de aplicação foram mantidos para preservar caminhos usados pelos Compose, volumes e quadros. Portanto, o primeiro marco é uma consolidação de repositório, não uma extração completa do código compartilhado: versões de core ainda podem divergir entre esses caminhos. Mudanças comuns devem ser integradas e verificadas nos runtimes afetados até a extração dos módulos compartilhados.

Uma funcionalidade comum recentemente promovida é a identidade visual/domínio por workspace. Seu serviço, componente e testes são idênticos nos quatro runtimes; migrations permanecem locais a cada banco. Consulte a documentação de integração em `suinda/app/SUINDA.md`.

## Safdoulas canônico

O runtime mais atualizado do Safdoulas é `safdoulas/app`, consolidado a partir do antigo caminho `safdoulas-v2/app`. A pasta local antiga `safdoulas/` (apenas dados/runtime, sem código) foi preservada sem alterações em `safdoulas-legacy-data-local/`; ela não contém uma segunda versão da aplicação. Volumes, bancos, nomes de contêineres e imagens Docker com o sufixo histórico `v2` são mantidos para continuar usando os recursos persistentes existentes.

Compatibilidade entre todos os plugins é regra canônica. Plugins comuns e específicos devem respeitar contratos compatíveis de versões, dependências, permissões e integração nos quatro runtimes.

## Preservação dos repositórios anteriores

Antes da consolidação, os quatro repositórios Git locais foram arquivados sob `control/backups/monorepo-migration-2026-11-10/`:

- `git-bundles/` preserva objetos e refs locais dos repositórios anteriores;
- `nested-git-metadata/` guarda cópias dos metadados `.git` originais;
- `working-diffs/` preserva as alterações rastreadas que ainda não tinham commit.

Esse diretório está ignorado pelo Git e não entra no monorepo. Os arquivos de trabalho atuais continuam na árvore e foram selecionados para o snapshot inicial, exceto dados locais e artefatos gerados. Os bundles não criam branches antigas no novo repositório.

## Exclusões do monorepo

Não são versionados: `.env` reais, credenciais, bancos e arquivos sob `data/`, backups, sessões, `node_modules`, caches/builds do Next.js, caches de agentes e estado operacional do CONTROL. Modelos de configuração sem segredos e código de operação são mantidos. A lista de exceções de exemplos de Suindá está em `.gitignore`.

O `control/environments.json` local foi atualizado para `main`, preservando os caminhos dos quatro projetos. Configurações de repositório/branch guardadas nos bancos das aplicações não foram migradas nesta operação. Antes de executar operações Git por cartões ou pipelines, confira que os projetos autorizam `main` e mantêm os caminhos de cada produto restritos.

## Commit e tag de referência

O commit raiz do repositório registra a árvore consolidada na branch `main`. A tag anotada `orbit-monorepo-baseline-2026-11-10` aponta para o snapshot que reúne os quatro runtimes e as alterações locais de código selecionadas. Ela não representa deploy nem validação funcional.

## Próxima etapa arquitetural

A consolidação Git elimina a necessidade de sincronizar branches, mas ainda não elimina cópias de código. A evolução recomendada é identificar contratos comuns, extrair core e plugins Orbit para unidades compartilhadas e fazer cada produto declarar apenas perfil/configuração e plugins exclusivos. Cada mudança deve preservar o isolamento de deploy e banco por ambiente.
