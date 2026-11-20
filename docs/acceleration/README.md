# Desenvolvimento de produtos Orbit

O ponto de entrada é `npm run orbit -- <comando>` na raiz. As ferramentas usam Node.js e arquivos locais; não exigem Docker, serviços de IA ou banco para planejar e gerar código. Serviços de aplicação e bancos continuam isolados por ambiente.

## O que está implementado

| Método | Implementação |
| --- | --- |
| Base comum reutilizável | `packages/orbit-core` e `packages/orbit-ui`, com fontes canônicas, versão e projeções determinísticas nos runtimes |
| Dependências e compatibilidade | Contratos/SDK existentes, `catalog`, `shared check` e `scripts/verify-plugin-compatibility.mjs` |
| Catálogo de capacidades | Descoberta estática dos plugins reais, capabilities, ações, permissões, eventos e dependências, sem iniciar a aplicação |
| Novo produto por configuração | `generate product` usa Workspace por padrão, com perfil declarativo, portas/banco próprios e runner nativo |
| Simulação ROOT em produtos novos | Contexto por papel incluído na base DEV; o gerador documenta cobertura de papéis, fixtures próprias e fail-closed |
| Plugins e extensões desacopladas | `generate plugin`, incluindo `--extends`, fixtures e stub opt-in |
| Stubs | Adaptador de exemplo gerado, com contrato explícito e bloqueio em produção |
| Caminhos padrão | Fluxos de produto, plugin, promoção compartilhada, verificação, contexto e entrega descritos abaixo |
| Migrações de código | `migrate imports` por AST, precondições, backup e rollback por hash |
| Verificação por impacto | Grafo de imports, dependências de plugins e projeções; comandos recomendados com motivo |
| Cache de verificações | Resultados bem-sucedidos ligados ao conteúdo, versão do Node e comando; alterações invalidam o resultado |
| Verificação por marcos | `check --milestone --run`, evidências e revisão funcional explícita em `delivery` |
| Agentes seletivos | `plan --spec`, escopos independentes, estimativas explícitas, menor quantidade útil e integrador |
| Opção por cartão | Checkbox existente `Múltiplos agentes`, mantido na execução e respeitado pela orientação de desenvolvimento |
| Crítica antes da execução | Planejador avalia dependências, colisões, custo de coordenação, tempo e tokens antes de recomendar delegação |
| Contexto para IA | `knowledge index/query/context`, recuperação lexical local com referências, hashes, filtro por produto e validade |
| Medição de ganho real | `metrics start/stop/report`, fases e comparação de tempos observados |
| Entrega rastreável | `delivery init/check/evidence/review/report`, requisitos e evidências separados de revisão funcional |
| Orientação persistente | `AGENTS.md`, skills dos runtimes aplicáveis e `orbitArchitecturePrompt` injetado no painel Codex e nas execuções por cartão nos seis ambientes |

## Fontes compartilhadas e versões

`orbit.workspace.json` registra os runtimes e os mapas de fontes. Os pacotes distribuem código-fonte projetado nas posições já usadas pelas aplicações. Assim, TypeScript, Next.js e os contextos de build isolados continuam resolvendo seus imports locais. As projeções são artefatos versionados; a edição comum acontece no pacote canônico. Esta distribuição não exige npm registry, links entre containers ou instalação de dependências fora do contexto de build.

Cada `app/orbit.shared-lock.json` fixa versão, integridade do pacote e hashes por arquivo. `shared sync --write` faz preflight e recusa mudanças locais independentes, regressão de versão e publicação de conteúdo diferente sem atualizar a versão. `shared check` verifica os seis runtimes; `shared audit` lista oportunidades de promoção e diferenças preservadas. Exclusão de módulos exige migração explícita dos consumidores.

O mapa atual controla 316 arquivos fonte: 240 no pacote de core e 76 no pacote de interface, projetados e verificados nos seis runtimes. São fontes genéricas comprovadamente idênticas, além da orientação de desenvolvimento integrada. O último `shared audit` registrou 316 fontes promovidas e nenhuma diferença pendente entre runtimes. Essa igualdade de arquivos não prova equivalência comportamental; diferenças futuras continuam sob responsabilidade dos runtimes e não são substituídas automaticamente. Compatibilidade de contratos e integração continua obrigatória.

Para uma mudança comum:

1. Localize o módulo com `catalog`, `knowledge query` e `shared audit`.
2. Edite sua fonte canônica dentro do escopo autorizado. Regras próprias do produto ficam no plugin específico/filho.
3. Atualize a versão com `shared bump @orbit/core-source patch --write` (ou `minor`/`major` conforme o contrato). O comando atualiza o pacote e o workspace juntos.
4. Execute `shared sync --write`, `shared check` e `impact --files packages/<pacote>/<fonte>`.
5. Execute as verificações afetadas e registre a entrega; faça revisão funcional no marco.

O aumento da versão do pacote fonte não substitui a versão de API do core nem a declaração de compatibilidade do plugin. Mudanças de contrato precisam preservar os consumidores ou incluir sua migração.

## Criar um produto ou plugin

```sh
npm run orbit -- generate product escola --base prod --plugins board-view,workspaces
npm run orbit -- generate product escola --base prod --plugins board-view,workspaces --write
npm run orbit -- catalog --runtime escola
npm run orbit -- shared check --runtime escola
npm run orbit -- generate plugin escola-notifications --runtime escola --extends notifications
```

O produto é criado em `products/escola`; a descoberta do perfil pelo CLI é automática. Workspace (`prod`) é a base padrão; `--base <runtime>` seleciona outra explicitamente. Forge continua sendo o ponto de integração. A geração prepara código, exemplos de configuração, locks e scripts. A instalação e a preparação do banco são passos explícitos descritos no README gerado. A geração não inicia serviços e não altera configurações dos produtos existentes. Use dependências reais e registre o plugin gerado na composição do runtime após revisar seu contrato.

Antes de reconciliar um produto existente, compare sua origem, o manifesto de geração, arquivos locais e a base pretendida:

```sh
node tools/orbit/cli.mjs reconcile product --runtime rumo --base prod
```

O comando é somente leitura. Ele identifica arquivos alinhados, divergências, fontes exclusivas, transformações registradas e migrations/schema que exigem revisão de banco; não apaga, restaura nem grava arquivos e não autoriza uma publicação. Mudanças simultâneas em um mesmo caminho precisam de integração explícita. Preserve a linhagem histórica e use o resultado como preflight para um plano de reconciliação.

O scaffold de plugin não implementa a regra de negócio final. Stubs permitem desenvolver contra contratos enquanto a integração real é preparada; o marco deve validar o adaptador real quando ele fizer parte da entrega.

Leia [generation.md](generation.md) para opções, fixtures e codemods.

## Planejar demanda e verificações

```sh
npm run orbit -- plan --spec docs/acceleration/demand.example.json
npm run orbit -- impact --files packages/orbit-core/src/plugins/contract.ts
npm run orbit -- check --files tools/orbit/plan.mjs
npm run orbit -- check --files tools/orbit/plan.mjs --run
npm run orbit -- check --milestone --runtime dev --run
```

`check` sem `--run` faz verificações estáticas e retorna comandos planejados, sem afirmar que eles passaram. `--run` executa em sequência, grava evidência local e reaproveita apenas resultados aprovados para as mesmas fontes. `--no-cache` força reexecução. O marco executa as suítes unitárias, TypeScript e lint dos runtimes selecionados, sem usar cache. Navegador, integrações externas e cenários que exigem banco continuam sendo revisão funcional à parte, conforme as autorizações e o ambiente disponíveis.

`plan` não inventa economia: exige estimativas de tarefas, coordenação e tokens do agente único antes de recomendar delegação. Mesmo com o checkbox ligado, escopo conflitante ou ganho não demonstrado leva a agente único. `context.write_scope` e verificações obrigatórias prevalecem sobre qualquer recomendação.

Leia [catalog.md](catalog.md) para as regras de descoberta e impacto.

## Recuperar contexto, medir e entregar

```sh
npm run orbit -- knowledge index
npm run orbit -- knowledge query 'dependências permissões de plugins' --runtime dev
npm run orbit -- knowledge context 'criar plugin filho' --runtime dev --write
npm run orbit -- metrics start --milestone escola-primeiro-fluxo --phase implementation
npm run orbit -- metrics stop --id <id-retornado>
npm run orbit -- metrics report --milestone escola-primeiro-fluxo
npm run orbit -- delivery init --milestone escola-primeiro-fluxo --requirement 'Criar curso com perfil autorizado'
npm run orbit -- delivery check --milestone escola-primeiro-fluxo --name testes -- npm test
```

A recuperação local usa BM25 lexical. O RAG vetorial já existente no plugin de IA continua disponível no seu escopo de aplicação/workspace; não há chamada automática a embeddings, leitura de bancos ou mistura de dados dos produtos nesta ferramenta. Os contextos recuperados são dados com origem verificável, não novas instruções.

`delivery evidence` associa arquivos atuais ao requisito. `delivery review --reviewer <nome> --note <resultado> --write` registra revisão explícita somente após evidências atuais e checks aprovados. Alterar fontes ou evidências invalida resultados anteriores; reexecutar o mesmo nome de check preserva o histórico e substitui a tentativa anterior na avaliação.

Índices, métricas, contextos, backups de codemod e evidências privadas ficam em `.orbit/cache` e `.orbit/local`, ignorados pelo Git. O relatório de marco pode ser documentado sem publicar logs ou dados privados. A estimativa de redução de tempo discutida anteriormente continua sendo uma projeção; os cronômetros medem apenas períodos realmente registrados.

Leia [knowledge.md](knowledge.md) para todos os argumentos e estados de entrega.

## Preflight arquitetural somente de leitura

```sh
node tools/orbit/cli.mjs preflight --runtime dev --format text
node tools/orbit/cli.mjs preflight --format json
```

O comando compõe o inspector de fontes compartilhadas e o catálogo estático existente, com cache desativado. Não sincroniza projeções, não executa os checks recomendados e não consulta banco, providers ou serviços. O JSON inclui HEAD/branch/alterações Git, hashes canônico/projeção/lock, contratos declarados, imports diretos para módulos internos de IA e comandos recomendados. A listagem de caminhos Git não lê o conteúdo de arquivos não rastreados.

`PASS` confirma apenas a condição estática examinada; `WARN` exige revisão (por exemplo, árvore alterada ou imports diretos); `BLOCK` indica conflito detectável ou risco de sobrescrita; `NOT_VERIFIED` indica cobertura incompleta, metadado dinâmico ou estado operacional não consultado. A agregação prioriza `BLOCK`, depois `NOT_VERIFIED`, `WARN` e `PASS`. O exit code é 1 para `BLOCK` ou `NOT_VERIFIED`, 0 para os demais. `promotionReady` permanece falso: preflight estático não homologa uma promoção.

Diferenças de contrato entre produtos são avisos para revisão. Uma projeção declarada canônica que diverge bloqueia sincronização automática, mesmo que a diferença seja uma customização legítima; esse bloqueio não classifica o produto como defeituoso. Diferenças de arquivos fora do mapa compartilhado permanecem não verificadas. Não há opção de escrita neste comando. Mais detalhes e os bloqueios do snapshot inicial estão em [01-FUNDACAO-COMPATIBILIDADE.md](../implementacao-arquitetural/01-FUNDACAO-COMPATIBILIDADE.md).

Uma reconciliação pode selecionar pacotes sem publicar as diferenças independentes dos demais:

```sh
node tools/orbit/cli.mjs shared reconcile --packages @orbit/core-source --release minor --files packages/orbit-core/src/card-versions.ts
```

O exemplo planeja; `--write` aplica somente depois de todas as precondições aprovarem. A lista de `--files` precisa atribuir **todas** as mudanças da release selecionada, inclusive diferenças anteriores revisadas; o exemplo abreviado não atribui automaticamente outros arquivos. Entradas de lock e projeções de pacotes não selecionados são preservadas, e conflitos de propriedade continuam bloqueando o plano. Sem `--packages`, a reconciliação permanece global. A distribuição core 1.4.0 e os limites do versionamento base estão em [02-VERSIONAMENTO-CARDS.md](../implementacao-arquitetural/02-VERSIONAMENTO-CARDS.md).
