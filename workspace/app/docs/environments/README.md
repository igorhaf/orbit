# Ambientes e atualizações do Orbit

## Uso cotidiano

Abra **Plataforma → Ambientes** em DEV ou produção. Cada cartão mostra a branch, o core, a saúde e a existência de alterações locais.

1. Desenvolva as melhorias genéricas em DEV e registre no Git a versão aprovada usando o fluxo Git existente.
2. Em produção, clique em **Verificar atualização**. O sistema identifica a versão de DEV e verifica o destino e seus plugins.
3. Resolva os bloqueios apresentados. Alterações locais e conflitos não são descartados nem publicados silenciosamente.
4. Clique em **Publicar atualização** e confirme. A integração Git, validações, imagens, backup e publicação ficam sob responsabilidade do CONTROL.
5. Depois de atualizar a produção, repita a verificação para o cliente desejado.
6. Acompanhe o histórico e o registro detalhado da operação. Fechar o navegador ou reiniciar a aplicação não cancela o trabalho do CONTROL.

**Validar código** executa build e testes com imagens candidatas, preservando as imagens publicadas e sem reiniciar o ambiente. Essa ação verifica o código atual, inclusive alterações locais; não cria uma versão publicada no Git.

O botão **Publicar atualização** autoriza a integração e seu registro Git local. Não faz push remoto, não reescreve o histórico existente e não substitui arquivos locais pendentes. A publicação exige uma versão registrada na origem e um destino sem alterações locais; o CONTROL não cria commits de trabalho do usuário automaticamente.

## Arquitetura

- O core versionado reside na aplicação; `apps/api/core-version.json` identifica a versão e a API de plugins.
- Plugins declaram `coreCompatibility: {minVersion, maxExclusive, pluginApiVersion}`. Plugins existentes herdam inicialmente core >=1.0.0 e <2.0.0, API 1; mudar uma interface de forma incompatível exige uma versão major e migração explícita dos dependentes.
- Os mesmos validadores são usados no SDK e no registry. Uma incompatibilidade impede carregar o plugin.
- Cada instância gera `/data/config/runtime-compatibility.json` sem credenciais. O inventário inclui versões e dependências dos plugins instalados, mesmo quando suas funcionalidades estão desativadas.
- O plugin desacoplado `environment-management` depende de `delivery`. Acrescenta a tela de Ambientes, privilégios `environments.read` e `environments.manage`, e configurações privadas do CONTROL em seu próprio botão de configuração.
- O handler `environment.update` permite usar o mesmo coordenador em Delivery Pipelines. Recebe `target` e `planId`, exige as permissões do operador e acompanha a operação persistente. Verificações de compatibilidade, backup e destino continuam obrigatórias.
- A execução de infraestrutura fica fora das aplicações, no CONTROL, com Docker e Git. O navegador nunca recebe o token do CONTROL e não pode enviar comandos shell ou caminhos arbitrários.
- O catálogo das instâncias fica em `control/environments.json`, fora dos repositórios de aplicação. Cada registro estabelece origem, branch, caminhos, serviços, imagens, banco e eventual proteção.
- O código do CONTROL está versionado junto ao core em `tools/orbit-control`; sua imagem é construída a partir dessa fonte.

## Publicação e isolamento

O plano fixa os commits da origem e do destino e a configuração do catálogo. Uma mudança depois da verificação exige outro plano.
A integração ocorre em worktree destacado. Um merge preserva os arquivos e commits exclusivos do cliente; conflitos bloqueiam a atualização e preservam o checkout original.
A candidata passa pelo Dockerfile de build existente, incluindo lint e TypeScript, e pelos testes unitários. As tags publicadas permanecem intactas durante as verificações. Em imagens imutáveis, os testes usam uma camada descartável, sem rede, credenciais ou volumes do cliente, e com afinidade limitada a dois núcleos para reduzir a concorrência dos testes.
Antes da publicação, novas gravações e execuções na origem e no destino são bloqueadas brevemente por um marcador de manutenção. Execuções já existentes precisam estar concluídas; filas e perguntas pendentes bloqueiam a publicação.
O banco ativo da aplicação precisa coincidir com o banco autorizado no catálogo; o banco padrão do contêiner PostgreSQL não é usado como suposição. O banco do destino é copiado para um backup próprio e verificado com pg_restore e SHA-256. Nenhum banco é copiado entre ambientes.
Somente depois dessas etapas as imagens são publicadas e os serviços do destino são recriados. A saúde precisa ser confirmada antes de registrar a versão instalada e avançar o checkout.
Instâncias de cliente publicadas usam imagens imutáveis, sem carregar código de um bind mount de desenvolvimento. O projeto permanece disponível em sua pasta de trabalho para o Orbit que o desenvolve.
Um lock por destino impede publicações simultâneas; o marcador da origem também impede duas publicações concorrentes na etapa final.

## Recuperação

O CONTROL preserva referências das imagens anteriores, o backup e um fingerprint do schema e do histórico de migrations.
Se a publicação falhar e o banco permanecer no estado anterior, as imagens anteriores são restauradas automaticamente e a saúde é conferida.
Se o schema ou o histórico de migrations mudou, o estado passa a **Requer recuperação**. O sistema mantém o destino protegido e não restaura dados automaticamente.
Na tela, o operador com privilégio de gestão pode digitar o identificador do destino e confirmar **Restaurar versão e banco anteriores**. Essa restauração substitui os dados atuais pelo backup; dados posteriores ao backup são perdidos.
A restauração verifica o checksum, o checkout, o destino e o papel do banco antes de parar serviços. Aplica o backup ao banco exclusivo do destino, restaura a propriedade para o papel da aplicação, reativa as imagens anteriores e verifica a saúde.
Um reinício inesperado do CONTROL marca operações interrompidas para revisão. Se a publicação já havia começado, não tenta adivinhar uma recuperação nem liberar automaticamente o destino.
Os registros persistentes ficam em `control/state/platform`; backups e logs devem ser protegidos e incluídos na política de retenção da infraestrutura.

## Inclusão de clientes

Cada novo cliente recebe seu banco, configurações e manifesto de plugins próprios. O catálogo aponta sua origem para produção.
A primeira inclusão precisa instalar o contrato de core e gerar o inventário de compatibilidade. Depois disso, as próximas atualizações usam a mesma tela.
Um ambiente com `protected: true` permanece visível, mas não aceita validação, publicação ou recuperação automática. Remover essa proteção exige confirmar que o trabalho em andamento terminou e revisar seu adaptador de build.
Plugins e regras exclusivos de um cliente continuam na branch do produto. Correções genéricas voltam a DEV e seguem pelo fluxo de publicação; nenhum fluxo de cliente promove código automaticamente para a origem.

## Validação

Os testes de CONTROL cobrem contratos, proteção de clientes, locks, manutenção, tags candidatas e preservação de alterações.
Os testes do core validam contratos e dependências. Builds e testes são executados sem Selenium/Chromium, conforme a regra do projeto.
Validar a interface em navegador continua sendo uma etapa separada, que requer um ambiente autorizado.
