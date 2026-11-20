# Plano de decomposição de plugins do Orbit

Data: 12/10/2026. Escopo: análise do catálogo atual de DEV e plano de evolução. Os IDs marcados como propostos ainda não estão registrados. A suspensão de dependências e sua apresentação ao vivo já usam o contrato existente.

## Regras

1. Uma base fornece capacidades compartilhadas e pode existir sem seus serviços filhos. Não depende de um filho.
2. Cada serviço declara `dependencies` obrigatórias; uma integração opcional usa um adaptador/contribuição separado. Não desligar um produto inteiro por uma função opcional.
3. Estado desejado (`configuredEnabled`) é diferente de estado efetivo (`enabled`). Desligar a base suspende transitivamente os dependentes, sem alterar seu estado desejado. Religá-la libera os habilitados; filhos desligados explicitamente continuam desligados. Múltiplas bases precisam estar disponíveis.
4. Catálogo expõe dependências diretas, dependentes transitivos, `blockedBy` e estado `active / disabled / blocked`. A tela mostra a causa e os serviços afetados. O servidor publica `plugins:changed` para conexões autenticadas; clientes recarregam o catálogo, navegação e layouts. Reconexão/foco e reconciliação periódica cobrem eventos perdidos.
5. Preservar credenciais, conexões, IDs de recursos externos, vínculos e dados dos cartões. Desativação não apaga nem revoga a conta externa. Reconectar somente se o provedor exigir novos escopos.
6. Dependências não concedem permissões. RBAC continua no core, catálogo inclui privilégios de cada plugin. Cofre fornece referências seguras; usuários e senhas de login não são itens do cofre.
7. O bloqueio precisa alcançar actions, rotas, clientes HTTP, workers, webhooks, backups e execuções internas. Uma checagem só no catálogo não basta.
8. Esta etapa não migra contas nem extrai todos os serviços abaixo. Implementar em fases, com testes e compatibilidade dos IDs existentes.

## Inventário e separações propostas

| Atual | Base / parte reutilizável | Plugins menores / dependências propostas | Observação |
|---|---|---|---|
| Google Calendar, Gmail, Google Drive | `google`: OAuth, contas, consentimento incremental, refresh, cliente HTTP, erros/quota comuns | `google_calendar → google`; `gmail → google + mail`; `google_drive → google` | `GoogleCredentials` já centraliza OAuth. Algumas rotas Calendar mantêm fallback de instância e lógica legada. Credenciais Google compartilhadas do core permanecem acessíveis por porta; redirects e variáveis específicos ficam nos filhos. |
| Drive atualmente voltado a backups | Drive genérico: pastas, upload/download, metadados e organização | `google_drive_backup → google_drive`; futuramente anexos/configurações como políticas do serviço de backup | Upload criptografado não deve ser o único contrato do Drive. Desligar Google suspende cópias remotas, preservando backup local e pendências. |
| Outlook Calendar, Outlook Mail, Teams | `microsoft`: OAuth/tenant, tokens por capacidade, Graph HTTP, erros e subscriptions | `outlook_calendar → microsoft`; `outlook_mail → microsoft + mail`; `microsoft_teams → microsoft` | `MicrosoftGraphClient` e subscriptions estão em calendar; `MailConnectionClient` ainda renova tokens Microsoft separadamente. Unificar sem perder os envelopes e scopes existentes. |
| Gmail e Outlook Mail | `mail`: threads, mensagens, rascunhos, resposta, anexos, contratos e layout comum | Adaptadores Gmail/Outlook separados; `smtp` e `mail_ingest` podem ser filhos opcionais | `MailService` e `MailProviderRegistry` já são compartilhados. A base não pode exigir Google ou Microsoft. O parser de entrada não deve obrigar IA. |
| Google Calendar / Outlook Calendar / fontes Orbit | Serviço genérico de calendário com registry de fontes, fusos, recorrência, agenda e disponibilidade | Base candidata `calendar`; adapters `google_calendar → calendar + google`, `outlook_calendar → calendar + microsoft` | Datas/schedule do card básico permanecem core. Extrair sincronização e layouts, mantendo o contrato de eventos. Não confundir desativar uma fonte com apagar os eventos. |
| Git | Git local: repositório, branches autorizadas, status, stage, commit, diff, undo/redo e transporte | `git` permanece genérico; pipelines saem para `delivery`; composição do layout pode virar `software-development-git → software-development + git` | Hoje `git` inclui deploy e usa `DeliveryGitService`. Git sem deploy e sem IA precisa continuar funcionando. IA apenas sugere descrição/tipo. |
| Delivery | Orquestração: etapas, aprovação, logs, status, retry e políticas | `delivery_git → delivery + git`; `delivery_ssh → delivery + ssh`; `github_actions → delivery + github`; `gitlab_ci → delivery + gitlab`; `bamboo → delivery + bamboo` | Extrair adapters de handlers/estratégias. A base delivery não depende de todos os provedores. Bloqueio de um adapter suspende apenas as etapas/pipelines que o usam. |
| SSH / comando local | Executor, credencial por referência, timeout/cancelamento e resultado comum | `ssh` reutilizável por delivery; executor local permanece independente | Não exigir SSH em pipelines locais. Registry de executores deve consultar disponibilidade, mesmo em chamada interna. |
| GitHub | `github`: autenticação, cliente HTTP, conta/repositório e rate limits | `github_issues → github`; `github_pull_requests → github`; `github_actions → github + delivery` | `GitHubClient` já separado do plugin. Manter compatibilidade com actions existentes e external_resources durante migração. Não obrigar Git local para consultar API GitHub. |
| Planner | Planejamento manual: blocos, regras e vínculos com calendário | `planner` manual; `planner_ai → planner + ai`; fontes externas via adapters | Atualmente `suggest_schedule` e Codex estão junto com o planejamento manual. Desligar IA não deve desligar blocos manuais. |
| IA / Codex | `ai`: contrato de geração/conversa/execução e formatos de resposta | Candidato `ai_codex → ai`; futuros provedores de IA como filhos | A seleção do provedor deve ser explícita e operações falham claramente sem provedor disponível. O core de projetos permanece independente. A fase anterior criou IA e sua porta opcional. |
| Alexa | Skill, assinatura, sessão, resposta curta e orçamento de tempo | `alexa-orbit → ai` já declarado; extrair transporte Alexa só quando existir outro consumidor | Evitar uma base vazia apenas para aumentar o catálogo. A aplicação Orbit por voz pode reutilizar plugins de tarefas/compras/agenda. |
| Cloudflare Tunnel | Operação do conector, configuração, supervisão e status | Manter independente; futuramente `cloudflare` auth/API e `cloudflare-tunnel → cloudflare` se houver uso da API da conta | O conector atual por token não exige API de conta Cloudflare. Criar dependência agora seria artificial. |
| Dropbox | Cliente OAuth/HTTP já separado de operações de arquivos | Manter `dropbox`; futuros `dropbox_backup → dropbox`, etc. | Só separar a base quando houver outro consumidor real. |
| Trello | Sincronização de quadros/listas e cliente específico | Manter `trello`; extrair cliente como base apenas se surgir outro módulo | Não impor dependência de IA ou workspaces. |
| Workspaces | Compartilhamento de recursos do core | Manter `workspaces` independente | RBAC/usuários ficam no core. Plugins de serviço podem respeitar workspace por port; isso não deve mudar perfis globais. |
| Cards/notificações e filesystem | Eventos e leitura de arquivos, respectivamente | Manter como capacidades pequenas | Não transformar o card básico em plugin obrigatório nem criar uma base genérica sem segundo consumidor. |

## Layouts de cards: os exemplos pedidos

Um layout é contribuição do plugin, não um novo `cards.kind` inventado. Título, descrição, anexos, comentários, checklist, contextos e schedule continuam com os contratos nativos. Campos exclusivos são guardados no namespace do plugin. O usuário pode compor complementos no mesmo card.

| Layout proposto | Plugin dono | Bases | Conteúdo / interação |
|---|---|---|---|
| Compromisso Outlook | `outlook_calendar` | `microsoft` + `calendar` (quando extraído) | Data/horário, fuso, duração, recorrência, participantes, vínculo com evento e situação de sincronização; datas gravadas via schedule nativo. |
| E-mail Outlook | `outlook_mail` | `microsoft` + `mail` | Remetente, destinatários, assunto, conversa, anexos, rascunho/responder/enviar; envio exige permissão e ação explícita. |
| Compromisso Google | `google_calendar` | `google` + `calendar` | Reutiliza renderer comum de compromisso com adapter Google. |
| E-mail Gmail | `gmail` | `google` + `mail` | Reutiliza renderer comum de e-mail com adapter Gmail. |
| Desenvolvimento | `software-development` | `ai` já implementado | Especificações, contexto e execução; contribuição Git separável para que desligar Git não impeça assistência/execução. |

O renderer comum pertence à base mail/calendar; o adapter fornece contas, capacidades e vinculação de recursos. Se estilos de cabeçalho/apresentação forem exclusivos, adicionar ao contrato uma seleção de apresentação principal por cartão; plugins complementares continuam coexistindo. Isso é evolução planejada: os novos layouts Outlook/Gmail/Calendar ainda não foram implementados.

Sem base disponível, manter os dados legíveis e o cartão básico acessível, mostrar “Aguardando Microsoft/Google/etc.” e bloquear operações daquele plugin. Religação restaura o layout e recursos, sem recriar eventos/mensagens ou repetir envios. Evitar texto/textarea genérico como substituto de um renderer de calendário ou e-mail funcional.

## Ordem de implementação

1. **Infraestrutura de dependências e estado ao vivo:** contrato, motivo do bloqueio, dependentes afetados, propagação para outras sessões, recomposição de UI. Implementado nesta etapa sobre dependências existentes.
2. **Google:** encapsular clientes comuns, registrar base, declarar filhos e cobrir todos os caminhos de backup/sync. Manter credenciais compartilhadas do core e IDs/conexões legados. Só então ligar a nova dependência na instalação.
3. **Microsoft:** retirar Graph de calendar, unificar refresh Mail, preservar tokens por capacidade e subscriptions; registrar a base e seus serviços.
4. **Mail e Calendar genéricos:** extrair contratos/renderer compartilhados; criar os layouts Outlook primeiro, depois reutilizar nos adapters Google. Introduzir apresentação principal apenas quando necessária.
5. **Git/Delivery:** deduplicar Git e credenciais por porta, separar adaptadores CI/SSH, garantir Git sem deploy; depois separar complemento Git de desenvolvimento.
6. **Planner/IA:** separar assistente de planejamento; decidir provider Codex como plugin filho com contrato estável.
7. **Demais:** manter pequenos plugins independentes até haver evidência de reaproveitamento. Não extrair uma base de token/HTTP para cada serviço sem necessidade.

## Aceite de cada fase

- Base e filhos funcionam habilitados; filhos sem base têm causa explícita de bloqueio.
- Cadeias transitivas e múltiplas bases; filho desligado manualmente não volta sozinho.
- Persistência após recarregar a aplicação; configurações e recursos preservados.
- Duas sessões abertas: mudança feita em uma/API refletida na outra, sem recarregar a página.
- APIs, callbacks, workers, backups e registries bloqueados; operações já iniciadas têm política definida (concluir/cancelar). Não declarar interrupção imediata se só há gate de novas operações.
- Retomar filas com idempotência: não duplicar backup, evento ou envio de e-mail.
- RBAC independente, credenciais por referência, scopes mínimos, nenhum segredo no evento WebSocket.
- Selenium desktop/mobile e validação das ações reais de cada layout com providers simulados.

## Pontos já identificados que precisam mudar antes de registrar bases

`BackupService` consulta diretamente `plugin_settings` do destino, sem resolução transitiva. `MailProviderRegistry` e outros registries específicos precisam filtrar disponibilidade efetiva. Delivery chama executores/handlers diretamente e precisa gate por etapa. Estes caminhos devem ser migrados na fase correspondente; adicionar somente `dependencies:['google']` ao catálogo deixaria backups e chamadas internas inconsistentes.

## Fontes locais examinadas

`google/credentials.ts`, `google/drive-backup.plugin.ts`, `calendar/google-calendar.plugin.ts`, `mail/connection-client.ts`, `mail/provider-registry.ts`, `calendar/microsoft-graph.ts`, `calendar/microsoft-subscriptions.ts`, `calendar/outlook-calendar.plugin.ts`, `calendar/microsoft-teams.plugin.ts`, `git/git.plugin.ts`, `delivery/git-service.ts`, `delivery/executors.ts`, `delivery/handlers.ts`, `delivery/runner.ts`, `github/github.client.ts`, `github/github.plugin.ts`, `planner/planner.plugin.ts`, `backup-service.ts`, `plugins/contract.ts`, `execution/registries.ts`, e catálogo autenticado `/plugins`.
