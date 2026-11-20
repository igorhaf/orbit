# Lacunas e contradições observadas

Este documento registra diferenças e pontos sem evidência suficiente; não propõe refatorações.

## Contradições documentais/configuração

| ID | Observação | Evidência | Efeito para a investigação |
| --- | --- | --- | --- |
| LC-01 | `suinda/README.md` descreve `app/` como repositório Git dedicado, enquanto `MONOREPO.md` e a raiz documentam monorepo único na branch `main`. | `suinda/README.md:7-10`; `MONOREPO.md:5-12` | Documentação do produto não está totalmente reconciliada com estado Git atual. |
| LC-02 | A documentação de arquitetura afirma publicação em loopback de web/API, mas configurações de Compose observadas publicam DEV web e Safdoulas web sem bind explícito 127.0.0.1. | `README-ARCHITECTURE.md:85-89`; `compose.yml:165`; `safdoulas/compose.yml:97` | A configuração declara exposição diferente; não prova reachability após firewall/proxy. |
| LC-03 | O helper CONTROL aceita DEV/PROD, mas inventário/configuração do monorepo inclui Safdoulas/Suindá. | `control/bin/orbit-env.py:14-16,41-43`; `control/environments.json`; `README.md:9-20` | Operação dos produtos pelo helper não é comprovada. |
| LC-04 | Compose raiz declara build de CONTROL apontando a `forge/app/tools/orbit-control/Dockerfile`, enquanto essa árvore não foi localizada; `control/Dockerfile` existente é outro caminho. | `compose.yml:189-197`; `control/Dockerfile:1-6` | Não é possível concluir qual build é efetivamente usado sem executar/consultar sistema operacional. |
| LC-05 | Safdoulas usa nomes de container/imagem/volume com `v2`, enquanto a aplicação canônica na árvore é `safdoulas/app`. | `safdoulas/compose.yml:1,7,13,34-35,88-89`; `MONOREPO.md:16-20` | Pode ser nome legado intencional; relação com recursos existentes não foi consultada. |
| LC-06 | Os arquivos compartilhados versionados cobrem apenas projeções mapeadas, mas os runtimes ainda têm arquivos equivalentes fora da lista e podem divergir. | `orbit.workspace.json`; `MONOREPO.md:5-12,38-45`; `docs/acceleration/README.md:29-45` | “Monorepo” não implica uma única implementação física por módulo. |

## Lacunas de integração/funcionalidade

| ID | Lacuna | Evidência e efeito |
| --- | --- | --- |
| LG-01 | Não foi localizado versionamento restaurável de conteúdo geral de card. | `cards` é mutável; `activities` é feed (`schema.sql:103-142,259`; `main.ts:881-963`). |
| LG-02 | Não foi localizado grafo de dependências entre cartões. | `card_runs.chain` existe, mas consumidores de DAG/blocked-by não foram identificados. |
| LG-03 | O Orbit não expõe agente como entidade persistida e supervisionada na implementação analisada. | `AgentRegistry` resolve arquivos; não há filhos/mensagens/atribuição no modelo localizado. |
| LG-04 | A opção multi-agent não é evidência de execução efetiva de agentes-filhos. | Marca e flag nativa persistem; ausência de registros individuais impede comprovar delegação do run. |
| LG-05 | Retry automático e cancelamento de prompt AI running não ficaram comprovados. | Recovery stale existe; cancel AI observado cobre queued/waiting-answer. |
| LG-06 | Serviço de retrieval vetorial existe, mas não foi localizado como injeção automática em todo contexto de cartão. | Export do serviço e persistência vetorial existem; candidatos são enviados pelo plugin host. |
| LG-07 | Recursos de entrega remota são parcialmente mockados conforme documentação do pipeline. | `workspace/app/docs/delivery-release-and-rollback.md:20-22`; deploy real não testado. |
| LG-08 | Compatibilidade completa de todas as combinações de plugin em quatro runtimes não foi demonstrada por esta auditoria. | Há contracts/checker/testes, mas não execução de matriz integral. |

## Estado não confirmado

- Health, serviços ativos, versão de migrations aplicada e conteúdo de banco não foram consultados.
- Contas externas, callbacks OAuth, credenciais, webhooks públicos, CI remoto, deploy e rollback real não foram executados.
- Configuração Git/branch guardada nos bancos não foi lida; a documentação informa que valores antigos não foram migrados.
- Testes existentes não foram rodados.

Essas lacunas permanecem fatos em aberto, não prova de que a funcionalidade inexista em outra fonte ou ambiente.
