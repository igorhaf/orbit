# Delivery Pipelines

Delivery Pipelines compõe actions do Orbit por meio de um registro de step handlers. O runner resolve, valida, persiste, executa e retoma os steps; ele não contém operações específicas de Git, SSH, deploy ou aprovação. `Git` e `SSH` continuam plugins separados. `CommandExecutorRegistry` contém `local` e `ssh`; `DeploymentStrategyRegistry` contém `git`; `PromotionStrategyRegistry` contém `git.merge`.

## Modelo

- **Server** representa um host SSH e sua credencial. Não representa um ambiente nem um deploy.
- **Environment** representa uma etapa lógica de um projeto; não precisa ter servidor.
- **DeployTarget** pertence a um Environment e escolhe executor, servidor opcional, diretório, repositório, remote e branch. Um Environment pode ter vários targets.
- **Pipeline** pertence a um projeto, tem trigger `manual` ou `card.completed` e lista ordenada de **PipelineSteps**. Cada step guarda `type`, `config`, timeout, política de falha, tentativas, intervalo de retry, dependências e política de bypass.
- **PipelineRun** guarda trigger, card, usuário, modo, motivo e contexto. **PipelineStepRun** guarda snapshot do step, status, tentativas, logs e outputs. Edições futuras do pipeline preservam o histórico.
- **Approval** é um registro persistido. Ao esperar aprovação, o runner encerra a execução ativa. Aprovar coloca o run na fila; o worker retoma no step seguinte. Rejeitar encerra o run.

`Deploy` atualiza um target; `Promotion` muda a revisão promovida. `Skipped` e `Bypassed` são estados diferentes. Permissão de administrador e permissão `pipeline.bypass` são independentes. Bypass altera o workflow, sem pular autenticação, validação de recursos, credenciais ou limites de projeto.

## Montagem

1. Em **Perfil → Projetos**, registre o repositório em **Git e deploy**.
2. Em **Delivery Pipelines**, crie as credenciais necessárias. O valor é criptografado com `SecretVault` e nunca retorna na API. Para SSH, cadastre um Server com fingerprint SHA-256 do host e execute **Testar conexão**.
3. Cadastre os GitRemotes com os nomes reais do repositório. Não há branch ou remote implícito. Configure os Environments e seus DeployTargets.
4. Crie o pipeline, adicione os steps, ordene e ative. O arquivo [delivery-default.example.json](delivery-default.example.json) mostra o fluxo de 13 steps. Substitua os identificadores pelos IDs criados e configure os comandos de build e restart em cada target.
5. Execute manualmente ou escolha `card.completed`. A conclusão de card dispara apenas pipelines que foram configurados explicitamente com esse trigger. Cards executáveis também podem chamar a action `delivery.run`.

Os campos do editor mudam conforme o tipo de step. `test.run` usa comandos genéricos e interrompe o pipeline se falhar, salvo política `continue` ou `retry`. O deploy Git realiza `fetch`, `checkout`, `pull --ff-only`, comandos de build e comando de restart no executor do target. O mesmo handler Git também executa em `local` ou `ssh`; o plugin SSH não conhece Git. A promoção `git.merge` faz fetch da origem, checkout do destino, merge e push.

## Execução e segurança

O modo normal executa todos os steps. O bypass exige habilitação explícita da permissão `pipeline.bypass`, motivo e `bypassPolicy` permitido no step. `allWorkflowPolicies` bypassa todos os steps permitidos e mantém os de política `deny`; as opções `tests`, `approvals`, `promotions` e `deployments` permitem seleção. Dependências de outputs (`steps.<id>.<output>` ou `context.<key>`) são verificadas antes e durante a execução. Um bypass que remove output obrigatório falha antes de iniciar. Steps bypassados ficam com status `bypassed`, motivo e evento de auditoria.

Secrets são referenciados por `credentialId`; o valor só é aberto durante a execução. Logs e outputs são sanitizados com os segredos conhecidos. Git com token HTTPS local usa cabeçalho de autenticação no ambiente do processo; chave SSH Git local usa arquivo temporário com permissão 0600 e verificação de host. Para Git executado em um Server, configure o acesso Git naquele servidor; credenciais Git do Orbit não são encaminhadas por SSH. Comandos livres são intencionais, configuráveis apenas por um usuário autenticado do projeto. O Git usa argumentos estruturados e valida caminhos, branches e URLs de remotes.

O lock de deploy é por `DeployTarget` e rejeita conflito; uma segunda execução pode ser iniciada após a primeira liberar o lock. Runs interrompidos durante um comando não repetem automaticamente o comando para evitar efeitos duplicados. Runs na fila e runs em espera de aprovação são retomáveis. A interface apresenta status, logs por step, outputs, motivo de bypass, aprovações e auditoria.

## API e validação

`GET /delivery/catalog`, `GET /delivery/projects/:id`, `POST /delivery/projects/:id/pipelines`, `PUT /delivery/pipelines/:id/steps`, `POST /delivery/pipelines/:id/runs`, `GET /delivery/runs/:id`, `POST /delivery/runs/:id/approve` e `/reject` são os principais pontos de integração. As operações Git adicionais estão em `POST /delivery/repositories/:id/operations` e na action `git.repository_operation`.

`npm run test:unit` testa registro, política, dependências, executores local e SSH simulado. `npm run test:integration -w apps/api` executa o fluxo normal completo e o mesmo pipeline em bypass, com Git real e remotes temporários, deploy local, testes e aprovações persistidas. Conexão com um servidor SSH real e deploy em infraestrutura externa dependem de um Server e credenciais configurados pelo usuário.
