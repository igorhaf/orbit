# Codex no Orbit: recursos e referências

Revisão: 22/10/2026. Plugin `codex-ide`, dependente de `ai`, ativável por instância.

## Referências oficiais consultadas

- https://learn.chatgpt.com/docs/codex/ide — experiência no editor, contexto e modelos.
- https://learn.chatgpt.com/docs/app-server — threads, turnos, eventos, aprovações e ferramentas.
- https://learn.chatgpt.com/docs/developer-commands — comandos do IDE e do terminal.
- https://learn.chatgpt.com/docs/permission-modes — permissões e limites de acesso.
- Protocolo gerado pelo executável instalado: `codex app-server generate-ts`.

## Recursos desta versão

| Recurso | Comportamento |
| --- | --- |
| Orelha lateral | Abre/recolhe o painel; largura normal e expandida; ocupa a largura disponível no celular. |
| Conversa | Envia mensagens ao app-server, apresenta Markdown, saídas de comandos e atualizações durante a execução. |
| Histórico | Conversas persistidas por usuário e projeto; pesquisa pelo título; retomada após reinício. |
| Anexos | Colar/enviar imagens PNG/JPEG/WebP; arquivos de texto incorporados à mensagem; remover imagem antes do envio. |
| Modelo e raciocínio | Catálogo real retornado pelo Codex; esforços informados pelo modelo. |
| Aprovações | Leitura com aprovações, escrita no projeto com aprovações externas, acesso completo condicionado a privilégio específico. |
| Perguntas | Perguntas enviadas pelo agente são respondidas pelo formulário dentro da conversa. |
| Planejamento | Instrução explícita de planejamento e sandbox de leitura para o turno. |
| Diff | Patch informado pelo turno, destaque de adições/remoções e contagem de linhas. |
| Desfazer | Reversão do patch atual após confirmação e verificação de conflitos, sem reset do repositório. Disponível durante a conexão que recebeu o patch. |
| /new, /fork | Nova conversa e cópia do histórico em uma nova conversa. |
| /compact | Solicita compactação ao app-server. |
| /review | Revisão das alterações ainda não commitadas. |
| /skills, /mcp | Consultam capacidades reais do runtime; não confundem plugins do Orbit com plugins do Codex. |
| /status, /model, /permissions, /plan | Estado e controles da conversa. |
| Interromper | Interrompe o turno ativo pelo protocolo oficial. |
| Copiar resposta | Copia o texto da resposta. |

## Diferenças e próximos recursos

Não é a extensão oficial do VS Code embutida. O painel implementa seu próprio cliente do protocolo público.
Recursos de Goal autônomo, Sketch, ditado, compartilhamento público, feedback à OpenAI e controle de plugins externos não foram implementados nesta etapa.
A opção de velocidade adicional depende do modelo/plano e ainda não é exposta pelo painel.
O contexto usa o projeto selecionado, AGENTS.md e skills configuradas; não recebe seleção ou arquivos abertos de um VS Code externo.
Não há promessa de porcentagem exata da janela de contexto sem uma medição correspondente do runtime.
Não se oferece aprovação automática de segurança com o rótulo “Aprove por mim”: isso exige um revisor efetivamente disponível no runtime; o modo do projeto usa aprovação humana nas ampliações de acesso.

## Segurança e operação

Cada usuário tem um processo app-server e histórico isolados no diretório persistente de sessões da instância; somente a autenticação do servidor é reutilizada.
A lista de sessões fica nas preferências do usuário, sem novas migrations ou alterações nos bancos dos clientes.
Toda rota exige plugin ativo, dependência ativa e privilégio RBAC; alterações também exigem `ai.write`.
`codex.ide.full` concede acesso completo ao servidor, separadamente do privilégio de conversa.
O projeto precisa pertencer ao usuário; IDs de threads de outros usuários são rejeitados antes de contatar o runtime.
A reversão não modifica o índice Git nem reescreve commits; conflitos impedem a operação.
Os processos são encerrados no desligamento do módulo e após inatividade, e pedidos RPC têm tempo limite.
Não há proxy aberto para comandos RPC arbitrários do navegador.
A validação visual com navegador está pendente, pois o projeto proíbe Selenium/Chromium neste host.
