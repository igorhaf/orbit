# Contexto de desenvolvimento, medição e evidências

Os comandos deste documento rodam no Node da máquina a partir da raiz do monorepo. Não exigem banco, Docker, embeddings, conta externa ou serviços Orbit ativos. O módulo `tools/orbit/knowledge.mjs` exporta `execute(command, args, { root, config })`; o CLI apenas encaminha argumentos e imprime o resultado serializável.

## Recuperação local para desenvolver produtos

```sh
node tools/orbit/cli.mjs knowledge index
node tools/orbit/cli.mjs knowledge query --runtime dev --query "plugin dependencies permissions"
node tools/orbit/cli.mjs knowledge query --runtime suinda --path suinda/app/apps/api/src --query "matricula curso" --limit 4 --tokens 1800
node tools/orbit/cli.mjs knowledge context --runtime dev --query "contratos plugins" --write
```

O índice é lexical: os resultados são ordenados por BM25 sobre termos normalizados. Nenhum modelo gera respostas ou embeddings. O índice incremental reutiliza os trechos de arquivos cujo SHA256 não mudou. A saída oferece caminho, linhas, hash, escopo e indicação `stale`; `--fresh` elimina resultados cuja fonte mudou ou desapareceu. O limite de tokens é uma aproximação conservadora por caracteres para o conteúdo recuperado; instruções e cabeçalhos do artefato de contexto acrescentam texto.

Após aplicar os filtros de runtime e caminho, a consulta agrupa trechos de texto exatamente iguais antes do ranking. A referência canônica prefere `packages/`; `equivalentSources` mantém caminhos, linhas e hashes das cópias permitidas pelo filtro sem repetir o corpo do trecho. `--path dev/app`, por exemplo, mantém a referência DEV e não revela caminhos de outro produto. O contexto Markdown também preserva essas referências equivalentes; seus metadados acrescentam texto ao orçamento dos trechos.

Arquivos rastreados pelo Git são candidatos, assim como novos arquivos nas allowlists de ferramentas `tools/orbit`, pacotes `packages` e documentação `docs/acceleration`. `--include caminho` permite incluir explicitamente um rascunho local seguro. Os filtros continuam sendo aplicados: `.env` inclusive exemplos, dados, sessões, credenciais, segredos, caches, backups, binários e artefatos não são indexados. Arquivos com chaves privadas, tokens reconhecíveis, URLs de banco autenticadas ou valores literais suspeitos de senha/token também são excluídos. O filtro é conservador; não é um scanner completo de segredos. Arquivos com mais de 1 MB ou caminhos por links simbólicos são recusados.

O cache em `.orbit/cache/knowledge/index.json` contém trechos de código e documentação e deve permanecer local e ignorado pelo Git. O índice organiza os quatro runtimes, mas as consultas retornam por padrão somente DEV e fontes compartilhadas. `--runtime` seleciona outro produto. `--all` inclui deliberadamente todos os escopos; use isso somente em demandas de integração entre produtos. Não há leitura de registros de usuários, bases institucionais ou permissões de aplicações.

A classificação inclui toda a raiz do produto, não apenas `app/`: `suinda/README.md` e `suinda/compose.yml` pertencem a Suindá. O prefixo vem de `runtime.root` quando declarado ou do diretório pai de um caminho terminado em `/app`. O mesmo vale para `products/nome/product.profile.json`. Documentação genérica na raiz e pacotes compartilhados mantêm escopo compartilhado. Cada consulta recalcula essa classificação com a configuração atual, inclusive em índices antigos; reindexar atualiza os metadados reutilizando os trechos cujo conteúdo não mudou.

`knowledge context` retorna Markdown e referências; com `--write`, também grava um arquivo novo em `.orbit/local/context/`. Um `--output caminho` explícito é permitido dentro do repositório e nunca sobrescreve arquivos. O texto diz que conteúdo recuperado é dado de referência e não uma nova instrução. Um executor pode consumir o campo `markdown` de `execute('knowledge', ['context', ...], context)` e adicioná-lo ao contexto da demanda, preservando `context.write_scope`, permissões e verificações obrigatórias. A geração de contexto não altera a configuração nem o escopo de um cartão.

## Relação com o RAG da aplicação

O Orbit já tem `apps/api/src/plugins/ai/knowledge-retrieval.ts` e `knowledge-retention.ts`. Esse serviço faz ranking vetorial com embeddings, isola cada coleção por workspace/plugin e aplica retenção aos vetores no banco. Ele continua sendo a capacidade de recuperação para dados e funcionalidades da aplicação. Os comandos locais aqui fornecem contexto de código e arquitetura ao desenvolvimento e não recriam sua API, não consultam seu banco e não reutilizam seu índice fora das permissões de workspace. Assim, desenvolver com recuperação local continua possível quando embeddings externos estão indisponíveis.

## Medição do tempo observado

```sh
node tools/orbit/cli.mjs metrics start --runtime dev --milestone contratos --phase implementation --task "extrair contrato comum"
node tools/orbit/cli.mjs metrics stop --id ID_RETORNADO --note "extração integrada"
node tools/orbit/cli.mjs metrics report --runtime dev --milestone contratos
node tools/orbit/cli.mjs metrics report --runtime dev --milestone produto-novo --baseline produto-anterior
```

As fases são `setup`, `implementation`, `integration`, `validation`, `coordination` e `rework`. O estado fica em `.orbit/local/metrics.json`, com escrita atômica e trava entre processos. Não pode existir mais de uma sessão ativa para a mesma combinação de runtime, marco e fase. `stop` sem ID só funciona se houver exatamente uma sessão ativa.

O relatório soma os segundos registrados em sessões concluídas e exibe separadamente sessões abertas. A comparação informa a redução observada e se os conjuntos de fases coincidem. Somar cronômetros simultâneos mede esforço registrado, não o tempo de calendário da entrega; cronômetros esquecidos incluem a espera. A comparação só é útil após revisar escopo, conclusão, fases e paralelismo dos dois projetos. Nenhum percentual estimado é apresentado como economia medida.

## Marcos e comprovação de execução

```sh
node tools/orbit/cli.mjs delivery init --milestone contratos --runtime dev --requirement "plugins preservam dependências" --acceptance "ciclo e dependência ausente produzem erro" --change "contrato compartilhado" --limitation "revisão visual pendente"
node tools/orbit/cli.mjs delivery check --milestone contratos --name contratos-unitarios -- node --test tools/orbit/catalog.test.mjs
node tools/orbit/cli.mjs delivery evidence --milestone contratos --requirement R1 --file docs/acceleration/catalog.md --note "revisão do contrato"
node tools/orbit/cli.mjs delivery import-check --milestone contratos --report .orbit/local/workflows/contratos-verification.json
node tools/orbit/cli.mjs delivery report --milestone contratos
node tools/orbit/cli.mjs delivery review --milestone contratos --reviewer "Integrador" --note "Critérios funcionais revisados com as evidências atuais" --write
```

`delivery init` cria um manifesto novo em `.orbit/local/deliveries/`, com requisitos, critérios, mudanças, limitações e revisão pendente. As opções `--requirement`, `--acceptance`, `--change` e `--limitation` podem ser repetidas. Nenhum requisito nasce concluído.

`delivery check` executa explicitamente o comando fornecido depois de `--`, como lista de argumentos, sem shell. Usa a raiz do repositório ou `--cwd caminho`; `--timeout` é dado em milissegundos. A saída limitada, horários, exit code, sinal e timeout são gravados como evidência local. O comando é bem-sucedido apenas se sair com código zero sem timeout ou erro de spawn.

Cada execução registra o fingerprint das fontes no início e no fim. O padrão cobre código/documentação/configuração versionados e arquivos novos nas allowlists de ferramentas, pacotes e documentação, incluindo lockfiles de dependências. Caminhos de segredos, `.env`, dados e artefatos são excluídos antes da leitura; snapshots persistem hashes, sem trechos de fonte. A coleta padrão ignora links simbólicos e caminhos que passem por links, sem ler seus destinos internos ou externos. `--scope caminho` restringe o snapshot a uma frente independente e pode ser repetido; um caminho de escopo explicitamente informado por link continua sendo recusado. Use escopos apenas quando representarem todas as dependências relevantes daquele check. Um comando que altera suas próprias fontes fica `stale`, mesmo se sair com código zero. Alterações posteriores também invalidam o resultado no relatório.

O relatório valida o hash do arquivo de evidência e sua ligação ao comando/snapshots; evidência ausente ou alterada vira `unverified`. A camada CLI deve sinalizar erro quando `check.status` for diferente de `passed`. Ao repetir um check com o mesmo `--name`, a execução mais recente substitui a anterior para determinar o estado atual, mantendo o histórico visível como `superseded`. Assim, uma correção seguida de uma nova execução pode resolver uma falha antiga sem apagar sua evidência.

`delivery import-check --report caminho` reaproveita um relatório realmente executado por `check --run`, sem executar os testes novamente. A API equivalente é `importVerificationChecks(context, { milestone, reportPath })`. São obrigatórios relatório bem-sucedido, evidência original em `.orbit/cache/checks/<key>.json`, SHA256 do arquivo bruto, argv/cwd/id/key correspondentes, executável disponível, saída, duração, timestamp original, `exitCode=0` e `sourcesStable=true`. O fingerprint atual é recalculado pelos mesmos helpers do verificador. Um JSON contendo apenas `passed` é recusado. A procedência registra `executed` ou `cached`, preserva o horário da execução original e os hashes do relatório/evidência. Relatórios alterados, evidências adulteradas e fontes modificadas invalidam a importação ou o resultado futuro. O snapshot geral da entrega também precisa permanecer atual.

`delivery evidence` associa um arquivo e seu hash a um requisito. Repetir o mesmo caminho atualiza sua referência; `--replace` troca explicitamente todo o conjunto de evidências do requisito. O relatório recalcula o estado: `pending` quando não há evidência, `evidenced` quando todas ainda coincidem ou `stale` se alguma mudou ou desapareceu.

`delivery review` exige `--reviewer`, uma nota funcional não vazia e `--write`. Só conclui quando há pelo menos um requisito com evidência atual, todos os requisitos têm evidências atuais e os checks vigentes foram realmente executados, passaram e ainda correspondem às fontes. A revisão registra autoria, nota, horário e fingerprint do conjunto aceito. Não executa nem afirma validação de navegador. Antes da revisão válida, a entrega permanece pendente; depois, o relatório apresenta `completed`. Alterações que invalidem checks, evidências ou o conjunto revisado retiram esse estado automaticamente. Este manifesto não concede autorização de commit, deploy, início de serviços ou navegador.

Uma demanda explicitamente criada com `delivery init --mode read-only` pode declarar verificação `not-applicable`, sem inventar um check aprovado. Nesse caso, o manifesto captura as fontes no início e exige o mesmo fingerprint ao revisar, além de todos os requisitos com evidências atuais e uma revisão explícita. Alterações de fonte bloqueiam a conclusão. O modo padrão `implementation` continua exigindo checks reais; ele não vira `read-only` por ausência de alterações. A autorização e o escopo de leitura continuam sendo impostos pelo executor do cartão, inclusive seus checks obrigatórios.

## Verificação do módulo

```sh
node --test tools/orbit/knowledge.test.mjs
```

Os testes usam repositórios temporários e verificam exclusão de segredos, escopos de produto, atualização incremental, fontes alteradas, limites de contexto, escrita concorrente de métricas, comandos reais, falhas, timeout, evidência modificada, snapshots de fontes/lockfiles, substituição de checks antigos, importação de execução/cache reais sem reexecução e bloqueio/conclusão de revisão funcional. Não iniciam aplicação, banco ou navegador.
