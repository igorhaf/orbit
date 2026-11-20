# Simulação ROOT dos perfis Suindá

O simulador preserva a sessão e o ator de auditoria ROOT e aplica as permissões efetivas do perfil selecionado. O Core fornece contexto genérico para cada papel do catálogo; o plugin `suinda-learning` acrescenta exemplos acadêmicos sintéticos conforme as permissões do próprio papel.

| Permissão efetiva | Exemplo estático apresentado |
| --- | --- |
| `plugin.suinda-learning.read` | Trilha demonstrativa de aprendizagem |
| `plugin.suinda-learning.write` ou `plugin.suinda-learning.publish` | Revisão de atividade de uma turma de exemplo |
| `plugin.suinda-learning.manage` | Operação acadêmica demonstrativa |

Os exemplos não são matrículas, cursos, atividades, pagamentos nem documentos persistidos. Não consultam dados reais, não criam contas ou registros, não autorizam rotas e não disparam integrações. Rotas de domínio sem fixture isolada continuam falhando fechadas; a simulação permanece somente de leitura.

Os testes em `apps/api/src/plugins/suinda/profile-simulation.spec.ts` verificam a inclusão por permissão e a ausência de exemplos docentes/administrativos para um perfil que possui somente `plugin.suinda-learning.read`.
