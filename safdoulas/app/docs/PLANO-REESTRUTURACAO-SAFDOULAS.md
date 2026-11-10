# Plano de reestruturação do Orbit e Safdoula

## Direção aprovada nesta conversa

- A branch `develop` deve conter somente o Orbit e capacidades reutilizáveis por outros projetos e plugins.
- O domínio, vocabulário, papéis, regras e dados que só existem por causa do Safdoula devem sair de `develop`.
- A branch `safdoulas` existente permanece intacta como backup histórico e não será alterada nesta etapa.
- Uma futura branch Safdoula será criada a partir do novo `develop`, mas essa criação está fora desta etapa.
- Capacidades genéricas identificadas nas migrations Safdoula serão adaptadas ao SDK e ao modelo de plugins do Orbit antes de entrar em `develop`.
- Dados de exemplo genéricos permanecem no Orbit, enquanto dados, papéis, documentos e conteúdo normativo do Safdoula são removidos do banco DEV.

## Base verificada

- O checkout real é `/home/meada/projetos/orbit/dev/app`, pois `/home/meada/projetos/orbit-dev` não existe.
- A branch atual é `develop` no commit `3828347dcb11fdb7d35f8177ab5f969e07055ec1`.
- A branch `safdoulas` e a tag `safdoulas-2026-10-13` permanecem no commit `0a8c39171b2e6174a6cc37e787988806a81582b0`.
- O trabalho Safdoula atual existe como alterações locais não commitadas, incluindo as migrations `078`–`117` e os módulos de domínio.
- O inventário da árvore atual contém alterações genéricas em arquivos rastreados e novos arquivos, que precisam ser separados antes de qualquer commit.
- O banco Orbit DEV registra as migrations `078`–`117` como aplicadas e não permite reescrever seus arquivos sem causar divergência de checksum.
- O banco Orbit DEV possui um quadro Safdoula com 4 listas e 242 cartões, além de 37 linhas em três tabelas Safdoula não vazias.
- As tabelas Safdoula atualmente não vazias são `safdoula_guideline_themes` com 27 linhas, `safdoula_normative_conflicts` com 9 linhas e `safdoula_processing_activities` com 1 linha.
- Nenhum código de produto, branch, commit ou dado do banco foi alterado para esta revisão do plano.

## Manter no Orbit `develop` como recursos já genéricos

- Manter RBAC, Workspaces, compartilhamento de recursos, tipos de cartões, layouts e visualizações estruturadas já presentes nas migrations `065`–`077`.
- Manter `079_account_auth_tokens.sql` com autenticação por convite, verificação de e-mail e recuperação de conta.
- Manter `096_access_audit_scopes.sql` com escopo genérico nos registros de auditoria e corrigir qualquer perfil inicial específico durante o seed genérico.
- Manter `099_auth_login_attempt_limits.sql` e `100_request_rate_limits.sql` como proteções genéricas de autenticação e requisições.
- Manter `102_monitoring_alert_profiles.sql` como configuração genérica de alertas operacionais.
- Manter `apps/api/src/access/`, os limites de login e requisições, o ciclo de vida de autenticação e os testes genéricos correspondentes.
- Manter os recursos de rotação de chaves em `keyring-crypto.ts`, `secrets.ts` e `vault-crypto.ts` para todos os plugins que guardam credenciais.
- Manter o sanitizador de conteúdo, o gerenciamento seguro de processos, os backups, o monitoramento e a política de migrations por serem infraestrutura geral do Orbit.
- Manter o rate limit da skill Alexa, o plugin de IA, o SDK de plugins, os contratos de dependências e as contribuições de layout e tipo de cartão.
- Manter os plugins Google, Microsoft, Git, Delivery, Workspaces e os ajustes de segurança que não dependem de entidades Safdoula.
- Manter autenticação, RBAC, Workspaces e telas genéricas existentes no frontend.
- Manter testes e documentação de instalação, segurança, autenticação, backups, publicação, rollback, plugins, RBAC, cartões e filas.
- Manter `scripts/migrate-dev-host.mjs` como ferramenta local de desenvolvimento do Orbit e manter `.orbit/runtime.json` fora do commit compartilhado por conter caminhos e endereços locais.
- Manter workspaces, usuários, quadros, plugins e dados de exemplo que não pertençam ao Safdoula.

## Generalizar e manter como plugins ou serviços reutilizáveis do Orbit

- Transformar o histórico append-only e a cadeia verificável da migration `097` em um serviço genérico de auditoria imutável sem nomes, tabelas ou filtros Safdoula.
- Transformar o registro de atividades de tratamento e solicitações da migration `098` em um plugin genérico de privacidade com referências neutras a recursos.
- Extrair de `078` o padrão genérico de snapshots versionados e imutáveis de registros, sem manter as entidades instituição e processo Safdoula.
- Extrair de `082` e `083` uma biblioteca genérica de documentos normativos versionados, anexos, publicação imutável e vínculo a recursos.
- Extrair de `084` e `086` a taxonomia, versionamento e publicação de diretrizes genéricas, removendo temas, eixos e textos curriculares Safdoula.
- Extrair de `087`, `089` e `090` conjuntos genéricos de parâmetros versionados, fontes de referência e validação de limites configuráveis.
- Extrair de `093` o aceite versionado de termos, com conteúdo publicado e histórico imutável sem linguagem ou exigências institucionais Safdoula.
- Extrair de `094` matrizes genéricas de avaliação com dimensões, critérios, versões publicadas e associação imutável a um recurso avaliado.
- Extrair de `095` prazos e relógios de SLA reutilizáveis, com extensão, pausa, retomada e histórico append-only configuráveis por plugin.
- Extrair de `101`, `110` e `111` o recebimento seguro, idempotente, versionado e imutável de documentos com hash e referências a versões específicas.
- Extrair de `105` e `106` declarações de relação, conflitos de interesse e acompanhamento de casos como plugin de conformidade sem papéis ou entidades Safdoula.
- Extrair de `112` formulários configuráveis, rascunhos, submissões idempotentes e snapshots imutáveis como plugin genérico de formulários.
- Extrair de `113` a geração de protocolos como serviço genérico de numeração de processos configurável por workspace ou plugin.
- Extrair de `114` transições configuráveis e histórico de workflows como plugin genérico de processos.
- Extrair de `115` revisões de triagem versionadas como etapa configurável de intake e análise.
- Extrair de `116` pendências, pedidos de complemento, responsáveis, prazos e respostas como recurso genérico de acompanhamento.
- Extrair de `117` a revisão independente de documentos anonimizados como capacidade de proteção documental configurável.
- Fazer os recursos extraídos dependerem apenas de contratos genéricos do SDK Orbit e declarar suas dependências entre plugins no manifesto.
- Criar migrations genéricas novas após a maior migration preservada, sem renomear ou alterar arquivos já aplicados no DEV.
- Criar dados de demonstração genéricos para os novos plugins e não copiar conteúdo, critérios ou regras dos documentos Safdoula como exemplos do Orbit.

## Retirar de `develop` por serem exclusivos do Safdoula

- Retirar todas as rotas, páginas e componentes de domínio em `apps/web/app/safdoulas/` e `apps/web/plugins/safdoulas/`.
- Retirar os serviços de instituições, acreditadoras, cursos, currículo, editais, parâmetros, matrizes, aplicações e processos específicos em `apps/api/src/safdoulas/`.
- Retirar verificadores de migrations e testes que validem apenas o esquema Safdoula em `apps/api/src/safdoula/`.
- Retirar o registro do plugin Safdoula, seus imports, providers, rotas e permissões de `main.ts`, `features.ts`, `privileges.ts` e `migrate.ts`.
- Retirar papéis, permissões, textos e configurações `federation_governance`, `formation_directorate`, `accreditation_workgroup`, `accreditor`, `accreditor_candidate` e `institution_representative` do core do Orbit.
- Retirar `ORBIT_DOCUMENT_SCANNER_BIN` e qualquer exigência de scanner que esteja acoplada exclusivamente aos documentos do fluxo Safdoula.
- Retirar nomes, CNPJ, cursos, ofertas, critérios de acreditação, prazos, estados de processo, campos de formulário e identificadores específicos do Safdoula.
- Retirar documentos, quadros, cartões, listas, conflitos normativos e demais registros cujo conteúdo tenha sido criado especificamente para Safdoula.
- Retirar de `develop` as migrations de domínio `078`, `080`–`095`, `097`–`098` e `101`, `103`–`117` depois de recriar suas capacidades genéricas com migrations novas.
- Preservar em `develop` os arquivos de migrations `079`, `096`, `099`, `100` e `102` com seus nomes e checksums atuais.
- Não manter schemas Safdoula em `develop` apenas para reaproveitar migrations antigas; os schemas equivalentes devem usar nomes e contratos genéricos.
- Manter `Dockerfile.safdoulas`, `compose.safdoulas.yml` e documentação exclusiva Safdoula somente no backup existente ou em uma futura branch específica.

## Tratamento de dados e migrations no DEV

- Fazer backup criptografado do banco Orbit DEV antes de qualquer alteração estrutural ou remoção de dados.
- Adicionar migrations novas que criem os schemas genéricos e removam tabelas, funções, triggers, permissões e dados do domínio Safdoula.
- Remover somente o quadro Safdoula e os registros relacionados ao domínio Safdoula, preservando usuários, workspaces, plugins, quadros e exemplos genéricos.
- Verificar após a migration que não restam tabelas, permissões, registros ou conteúdo Safdoula em `develop` e que os dados genéricos permanecem disponíveis.
- Apagar a cópia de backup temporária após validar a limpeza solicitada e a integridade dos dados genéricos.

## Ordem de execução após organizar este plano

- Congelar um inventário dos arquivos locais para separar mudanças genéricas, código Safdoula e artefatos locais sem descartar trabalho.
- Manter a branch `safdoulas` atual sem alterações nesta etapa.
- Implementar e testar primeiro os serviços genéricos de auditoria, privacidade, versionamento, documentos e workflows extraídos das migrations.
- Generalizar os demais plugins extraídos e substituir as referências e permissões específicas por contratos de plugin neutros.
- Remover de `develop` o módulo Safdoula, suas rotas, papéis, documentação, fixtures e migrations exclusivas.
- Aplicar as migrations novas ao DEV somente depois de validar o backup, a compatibilidade com banco vazio e a preservação de dados genéricos.
- Executar lint, testes, builds e verificações de busca por referências residuais a `safdoula` antes de considerar o `develop` limpo.
- Não criar a nova branch Safdoula nem alterar branches remotas durante esta etapa.
