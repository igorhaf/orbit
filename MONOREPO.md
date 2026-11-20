# Consolidação do repositório Orbit

## Marco inicial

Em 10/11/2026, o diretório `/home/meada/projetos/orbit` passou a ser o repositório Git único, na branch `main`. Os checkouts locais anteriores foram consolidados como conteúdo da árvore atual:

- `forge/app` — runtime Orbit DEV;
- `workspace/app` — runtime Orbit PROD;
- `safdoulas/app` — runtime Safdoulas;
- `suinda/app` — runtime Suindá.

Os diretórios de aplicação foram mantidos para preservar caminhos usados pelos Compose, volumes e quadros. Portanto, o primeiro marco é uma consolidação de repositório, não uma extração completa do código compartilhado: versões de core ainda podem divergir entre esses caminhos. Mudanças comuns devem ser integradas e verificadas nos runtimes afetados até a extração dos módulos compartilhados.

Uma funcionalidade comum recentemente promovida é a identidade visual/domínio por workspace. Seu serviço, componente e testes são idênticos nos quatro runtimes; migrations permanecem locais a cada banco. Consulte a documentação de integração em `suinda/app/SUINDA.md`.

## Safdoulas canônico

O runtime mais atualizado do Safdoulas é `safdoulas/app`, consolidado a partir do antigo caminho `safdoulas-v2/app`. Não há uma segunda pasta de aplicação `safdoulas-v2` na raiz atual. O histórico remoto anterior foi preservado pela tag `backup/remote-before-monorepo-2026-11-10`. Volumes, bancos, nomes de contêineres e imagens Docker com o sufixo histórico `v2` são mantidos para continuar usando os recursos persistentes existentes. Dados locais não fazem parte do snapshot Git; não se deve presumir a existência de uma pasta de backup apenas pela documentação antiga.

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

## Fontes compartilhadas e desenvolvimento de novos produtos

A base reutilizável agora tem fontes canônicas em `packages/orbit-core` e `packages/orbit-ui`, consumidas como projeções versionadas nas posições locais dos runtimes. `orbit.workspace.json` declara os mapas; os locks de cada aplicação fixam versão e hashes. `shared check` e a verificação de compatibilidade detectam desvio. As cópias restantes que ainda têm variantes são preservadas e aparecem em `shared audit`; seu isolamento não equivale a comprovação de equivalência funcional.

O CLI `node tools/orbit/cli.mjs` fornece catálogo, impacto, geradores de produto/plugin, stubs, codemod reversível, fontes compartilhadas, contexto local, planejamento de agentes, verificações com cache, métricas e marcos de entrega. Novos produtos usam `products/<id>` na mesma branch `main`, com perfil e banco isolados. Consulte `docs/acceleration/README.md` para comandos e regras. O fluxo não exige Docker para planejamento/geração e não altera automaticamente o ciclo de vida das instâncias existentes.
