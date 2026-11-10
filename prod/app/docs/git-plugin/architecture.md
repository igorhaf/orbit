# Plugin Git do Orbit

## Limites e integração

O plugin `git` é um módulo Nest separado de `Service`, execução de IA e plugin GitHub. Ele usa somente os identificadores de projetos `ai_projects`, quadros, listas e cards do Orbit. Sua API é `/git/*`; registros de versionamento e execuções ficam em tabelas `git_*`. O catálogo de plugins registra capacidades e ações de leitura, commit e deploy. Nenhuma configuração de deploy é gravada no card.

Um repositório pertence a um projeto local e aponta para uma subpasta dentro dele. Sua lista de branches permitidas é a política de versionamento, inclusive quando não há deploy. O projeto guarda `default_git_repository_id`: o primeiro repositório cadastrado vira padrão, e o dono pode trocá-lo no perfil. A detecção automática permite apenas a branch em uso; outras branches precisam de configuração explícita. Um projeto pode ter zero ou vários destinos de pipeline. Cada destino pertence a um repositório, define provider, referência do pipeline, branches permitidas (subconjunto do repositório), etapas e credencial cifrada. A associação opcional `lista → destino + etapa` relaciona a coluna do quadro a um estágio. A associação `card → projeto` existente, ou o projeto padrão do quadro, resolve a configuração para o card.

## Execução

`git` local usa `execFile`, sem shell, dentro da pasta validada do repositório. Antes de `add`, `commit`, `push` ou `pull`, verifica se a branch atual é permitida pelo repositório e, quando há destino, também pelo pipeline. O usuário solicita explicitamente as operações; mover card entre colunas não dispara deploy. Commits automáticos usam `feat`, `fix` ou `chore`, assunto Conventional Commits e corpo com até duas linhas. Ao preparar um commit de um cartão concluído, o Orbit cruza os arquivos registrados nas execuções do cartão desde seu último commit com as alterações locais ainda pendentes. Apenas essa interseção vem marcada; outras alterações exigem escolha manual. O tipo e o título sugerido pelo resumo da execução de IA aparecem editáveis acima das listas em Atividade; quando não há resumo de IA, o título do cartão serve de base. A descrição e os arquivos podem ser revisados no modal antes de criar o commit. O commit criado é associado automaticamente ao cartão. Em Atividade aparecem os cinco commits mais recentes do cartão e os cinco globais da branch atual permitida. Cada lista abre um modal paginado com o histórico completo, arquivos e diff sob demanda, limitado a 120 mil caracteres. O painel Git e deploy permanece recolhido no rodapé esquerdo para operações avançadas e pipelines.

Um adaptador por provider dispara GitHub Actions, GitLab CI/CD ou Bamboo por HTTP com a branch já autorizada. SSH, `git pull` e demais passos remotos são definidos no pipeline do provedor; o Orbit dispara e acompanha a execução, sem executar comandos arbitrários de SSH no servidor Orbit. O destino configura um fluxo anterior ao pipeline: `pipeline_only`, `commit_push` (add, commit e push com arquivos explícitos) ou `pull_push` (pull com árvore limpa e push). As quatro operações também estão disponíveis individualmente; todas verificam a branch autorizada. O método de deploy (`provider`, `ssh` ou `git`) é atributo do destino e descreve as tarefas configuradas no pipeline, nunca do card. `pull` exige árvore limpa para evitar misturar alterações locais. O provider informa status e logs quando sua API disponibiliza esses dados.

## Acesso e segredos

Somente o dono do projeto configura repositórios, destinos, branches e credenciais. Membros do quadro podem ler o histórico de cards; ações de escrita Git e deploy exigem dono do projeto. Tokens de pipeline são cifrados com `SecretVault`, não retornam pela API, não entram nos logs e são enviados somente ao endpoint configurado. URL de pipeline deve ser HTTPS (ou localhost para testes), e o host configurado nunca é aceito como parâmetro na execução. Credenciais locais para push/pull vêm do Git/SSH agent do host, não dos dados do card.

## APIs dos provedores

- [GitHub Actions: workflow dispatch e execução](https://docs.github.com/en/rest/actions/workflows)
- [GitLab: criação e consulta de pipelines](https://docs.gitlab.com/api/pipelines/)
- [Bamboo: fila, resultados e logEntries](https://docs.atlassian.com/atlassian-bamboo/REST/6.0.4/)

Os pipelines externos devem definir suas próprias credenciais SSH no provedor. O Orbit não transmite chaves privadas de SSH do card. Para `commit_push` e `pull_push`, o Git local usa o remote já configurado no repositório e a credencial Git/SSH do host.

No Bamboo, cada destino aponta para a chave de um plano ou branch específica e aceita uma branch configurada. Para várias branches Bamboo, crie destinos distintos; a variável `ORBIT_BRANCH` também é enviada ao plano para validação interna.
