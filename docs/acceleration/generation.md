# Geração, exemplos locais e migrações assistidas

Os comandos usam os contratos atuais do Orbit. Novos produtos usam Workspace (`prod`) como base por padrão; Forge (`dev`) continua sendo a bancada de integração e compatibilidade. O padrão é mostrar um plano. A escrita exige `--write`; a geração não instala dependências, cria bancos, inicia serviços, altera branches ou faz deploy.

## Novo produto

```sh
node tools/orbit/cli.mjs generate product escola --base prod --plugins board-view,workspaces
node tools/orbit/cli.mjs generate product escola --base prod --plugins board-view,workspaces --write
```

O destino padrão é `products/escola`, com a aplicação em `products/escola/app`. `--target` permite escolher outro caminho relativo dentro do monorepo. Destinos existentes, caminhos fora do repositório, links simbólicos e colisões com portas configuradas são recusados. `--web-port`, `--api-port` e `--theme` permitem configurar o produto. O perfil padrão usa tema escuro, portas não reservadas no workspace a partir de 3010/4010 e banco `orbit_escola`.

O identificador do novo produto precisa ser exclusivo entre runtimes e produtos configurados. Destinos dentro de aplicações existentes, fontes dos pacotes compartilhados ou diretórios `.orbit`, `control` e `tools` são reservados e recusados, inclusive com `--target` explícito.

O gerador copia apenas arquivos rastreados da base selecionada (Workspace por padrão), preservando a interface, a lógica e o modelo de permissões existentes. `--base <runtime>` seleciona explicitamente outro runtime configurado. Ele exclui `.env` reais, dados, dependências instaladas, builds, sessões, resultados de navegador, snapshots dos ambientes e artefatos específicos de Safdoulas/Suindá. Projeções declaradas em `sharedPackages` são preenchidas a partir de suas fontes canônicas. A versão e os hashes dessas projeções ficam no perfil.

`product.profile.json` registra os plugins solicitados, suas dependências transitivas habilitadas e os demais plugins desabilitados. Um modo de quadro (`board-view` ou `structured-view`) é obrigatório. Plugins reutilizáveis permanecem disponíveis no código; o perfil controla sua ativação no banco do produto. `generation.manifest.json` registra o commit de origem e SHA256 dos arquivos gerados, permitindo comparar a origem com alterações posteriores.

A origem é a árvore de trabalho atual dos arquivos rastreados, acrescida das fontes canônicas. O manifesto explicita `mode: working-tree`, o estado `dirty` e as versões/integridades compartilhadas; o hash do commit sozinho não representa alterações locais ainda sem commit.

Na cópia de `065_rbac_core.sql` do produto novo, o gerador substitui exclusivamente a instrução legada `UPDATE users SET is_root=true WHERE email='<literal>';` por um comentário que delega o bootstrap ao `ensureBootstrapRoot`. As demais instruções SQL permanecem intactas. As migrations dos runtimes existentes não são editadas. A adaptação consta em `transformations` no manifesto, com caminho e SHA256 da fonte e do resultado, para distinguir a base original da árvore adaptada do produto novo.

`app/orbit.shared-lock.json` é gerado a partir dos snapshots canônicos, com a identidade do novo produto, versão, integridade e hashes de cada projeção. Ele substitui qualquer lock do DEV e é reconhecido pelos comandos `shared check` e `shared sync`. O `AGENTS.md` do produto reafirma a branch única `main` e os caminhos canônicos; o produto não cria um repositório próprio. A descoberta automática dos perfis em `products/*` permite usar o produto nos comandos do monorepo; destinos personalizados precisam ser declarados na configuração do workspace.

Após revisar o resultado:

1. Copie `.env.example` para `.env` e configure credenciais/segredos próprios; `JWT_SECRET` exige pelo menos 32 caracteres. Para um banco novo sem ROOT, preencha `ORBIT_BOOTSTRAP_ROOT_NAME`, `ORBIT_BOOTSTRAP_ROOT_EMAIL` e `ORBIT_BOOTSTRAP_ROOT_PASSWORD` (mínimo 12 caracteres, máximo 72 bytes UTF-8). O seed preserva contas ROOT existentes e recusa promover uma conta comum que já use o e-mail escolhido.
2. Provisione explicitamente o PostgreSQL e o banco declarado no perfil.
3. Execute `npm --prefix app ci` na raiz do produto para instalar as dependências pelo lock existente.
4. Execute `npm run db:prepare` na raiz do produto. O wrapper carrega `.env`, verifica o banco declarado e chama as migrations e o seed existentes. `npm run db:migrate` e `npm run db:seed` permitem executar cada etapa separadamente.
5. Execute `npm run profile:plan` e depois `npm run profile:apply` na raiz do produto.
6. Inicie explicitamente com `npm run dev`.

O aplicador de perfil confere o nome do banco em `DATABASE_URL` e faz as alterações em transação. O runner nativo confere banco e segredos antes de iniciar API/Web com as portas próprias. Nenhum dos dois depende de Docker. O perfil gerado é uma configuração do produto; não concede permissões a usuários nem substitui o RBAC.

Todo produto gerado já recebe o mecanismo comum de simulação ROOT da base DEV e a documentação `docs/profile-simulation.md`. A revisão do produto deve confirmar que cada papel global (incluindo papéis criados por plugins ou posteriormente) apresenta persona, workspace, exemplos e fluxos compatíveis com suas permissões. Plugins de domínio devem contribuir fixtures próprias sem consultar dados reais. Rotas sem fixtures isoladas falham fechadas; a simulação permanece somente leitura até que operações de escrita estejam limitadas aos próprios exemplos.

## Reconciliação automática de fontes compartilhadas

O executor pode finalizar uma alteração canônica chamando `reconcileShared(context, options)`, exportado por `tools/orbit/shared.mjs`. A execução informa os arquivos que realmente alterou em `changedFiles`; a rotina planeja o incremento de versão, os metadados, as projeções e os locks afetados. O incremento padrão é `patch`; a IA pode declarar `minor` ou `major` conforme o contrato alterado. Uma versão canônica já avançada de forma consistente não recebe outro incremento, e repetir uma execução reconciliada não gera novas escritas.

`allowWrite: false` devolve apenas o plano. Para aplicar, `allowWrite: true` continua sujeito a todos os arquivos exatos de `writeScope`, quando definido, e ao limite absoluto de `projectRoot`. O retorno informa `changedPaths`, `requiredScope`, diagnósticos e releases planejadas; a rotina não amplia autorizações. Modificações canônicas preexistentes fora de `changedFiles`, releases anteriores incompletas sem atribuição e alterações independentes em projeções impedem a aplicação. Regressões de versão ou remoções de projeções exigem uma migração explícita e preservam o código existente.

Todas as escritas são planejadas e autorizadas antes de alterar qualquer arquivo. Fontes, metadados e locks são revalidados imediatamente antes de persistir; uma falha tenta restaurar todos os destinos já tentados, preservando modificações concorrentes detectadas. Produtos descobertos recebem suas projeções e locks, enquanto a configuração persistida mantém apenas o inventário originalmente declarado. Esse passo faz parte da execução da IA e dispensa edição manual de versões ou um comando humano de sincronização. A reconciliação não substitui compilação nem as verificações de compatibilidade selecionadas por impacto.

## Novo plugin e plugin filho

```sh
node tools/orbit/cli.mjs generate plugin escola-inscricoes --runtime dev
node tools/orbit/cli.mjs generate plugin escola-inscricoes --runtime dev --extends workspaces --write
```

O plugin é criado em `apps/api/src/plugins/<id>` no runtime escolhido. IDs já presentes, pais/dependências ausentes e ciclos são recusados. O gerador produz uma definição que usa o SDK real, uma faixa de compatibilidade baseada na versão atual do core, capability/permissão e uma action de exemplo. `--dependencies id,id` acrescenta dependências. `--extends pai` declara tanto `parentPlugin` quanto a dependência do pai, preservando o plugin original.

A integração no bootstrap permanece explícita: o README gerado aponta o export a registrar pelo `PluginRegistry`. As permissões precisam ser declaradas e concedidas pelos mecanismos atuais. O código gerado deve ser revisado e integrado nos runtimes aplicáveis antes da entrega.

O adaptador de exemplo aceita apenas o payload declarado na fixture, exige `mode: "example"` e bloqueia execução com `NODE_ENV=production`. Isso permite desenvolver consumidores sem acionar serviços externos. O modo de exemplo não vira uma integração real automaticamente; implemente o adaptador real mantendo o contrato e valide a troca antes de produção.

## Migração de imports e rollback

```sh
node tools/orbit/cli.mjs migrate imports --from ./antigo --to ./novo --files forge/app/apps/api/src/exemplo.ts
node tools/orbit/cli.mjs migrate imports --from ./antigo --to ./novo --files forge/app/apps/api/src/exemplo.ts --write
node tools/orbit/cli.mjs migrate rollback --id imports-AAAA-MM-DDTHH-MM-SS-sssZ-PID
node tools/orbit/cli.mjs migrate rollback --id imports-AAAA-MM-DDTHH-MM-SS-sssZ-PID --write
```

O codemod usa a AST do TypeScript instalado em DEV e altera apenas especificadores exatos em `import`, `export ... from`, `import()` e `require()`. Strings de negócio e comentários ficam intactos. Fontes com erros de sintaxe são recusadas. Os arquivos são informados explicitamente em `--files`, separados por vírgula.

Antes de escrever, o comando registra os originais e hashes em `.orbit/cache/migrations/<id>` e revalida as precondições. O rollback só restaura arquivos cujo conteúdo ainda corresponde ao resultado da migração; alterações posteriores impedem a restauração, preservando trabalho novo. Revise o diff e execute as verificações por impacto depois de qualquer migração. Backups locais não entram no Git.
