# Checklist de implementação do plugin Git

- [x] Arquitetura desacoplada e pontos de integração: `architecture.md`; registro `git` no catálogo de plugins e rotas próprias.
- [x] Modelo projeto, repositório, destinos, colunas, etapas, commits e execuções: migrações 040 e 041 aplicadas; teste de esquema isolado.
- [x] Versionamento sem deploy e múltiplos destinos por projeto: teste de integração cria commit antes de qualquer destino e depois cinco destinos.
- [x] Mapeamento opcional coluna → etapa: API e formulário; teste de integração.
- [x] Configuração de deploy em projeto e coluna: formulário do perfil e mapeamento; build web.
- [x] Histórico em cards com título, corpo/comentários, arquivos e merges: API, painel e teste de merge com dois pais.
- [x] Conventional Commits e corpo com até duas linhas: teste de regra e commit real em repositório temporário.
- [x] Branches configuradas: política do repositório e subconjunto dos destinos, validação de operações e teste de rejeição.
- [x] GitHub Actions, GitLab CI/CD e Bamboo: adaptadores de disparo; testes HTTP simulados dos três e consulta de status.
- [x] SSH e fluxos add/commit/push/pull: método SSH no destino, execução via pipeline, fluxo local `commit_push` e `pull_push`; repositório e remote temporários testados. SSH remoto real depende das credenciais e tarefas definidas no provedor.
- [x] Credenciais e permissões: token cifrado, API sem retorno do segredo, escrita restrita ao dono do projeto e leitura do histórico para membro do quadro; teste de integração.
- [x] Status, logs e falhas: tabela de execuções, atualização e painel; testes de sucesso e falha simulada. GitHub mostra jobs/etapas; GitLab trace e Bamboo logEntries.
- [x] Testes de versionamento e deploy: suíte de regras, adaptadores e integração real com Git local e provedor simulado.
- [x] Lista de commits em cada card: dois resumos de cinco commits abaixo dos comentários em Atividade e modais paginados com diff. O cartão concluído mostra tipo e título sugeridos pela execução de IA acima das listas; o botão de revisão preserva a edição, sugere os arquivos registrados na execução e associa o novo commit automaticamente. Build, testes de regra e seleção de arquivos, leitura real do repositório e Selenium completo passaram na API DEV.

Validações de serviços externos foram simuladas. Nenhum deploy remoto nem SSH real foi executado.
