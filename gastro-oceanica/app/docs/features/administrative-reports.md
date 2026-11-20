# Relatórios administrativos

## Implementado

- `gastro-reports` é um plugin filho de `gastro-clinic`; depende explicitamente da gestão clínica e expõe a navegação `Relatórios` somente a quem tem `plugin.gastro-reports.read` no workspace.
- A primeira consulta é **Atendimentos realizados**, com período inclusivo por data UTC, quatro agrupadores (pessoa atendida, convênio, procedimento/serviço e profissional) e subagrupamento opcional por qualquer categoria diferente do agrupador principal. A seleção igual é desabilitada na interface e recusada pela API. Considera registros atuais de agendamento no estado Orbit `completed` (rótulo apresentado como “Paciente atendido”).
- A resposta contém apenas rótulos de cadastros relacionados que o ator também pode ler, totais agregados e período. Não retorna IDs de registros, finalidade, notas, células individuais ou exports. No agrupamento por pessoa, mostra o título do cadastro somente após autorização individual; sem autorização, referências são reunidas em um rótulo genérico. Quando não há vínculo, exibe “Não informado”.
- O seletor de período oferece Hoje, Esta semana, Este mês, Últimos 30 dias, Todos e Personalizado. Os presets são resolvidos em UTC; esta semana significa segunda-feira até hoje, e últimos 30 dias inclui hoje e os 29 dias anteriores. Esses limites temporais são decisões locais porque a referência confirma os rótulos, mas não todas as fórmulas de data.
- Cada agendamento passa pelo `ExtensionRecords.detail`, que revalida a autorização resource-scoped e registra a auditoria de leitura. O cadastro relacionado também passa pela mesma autorização antes de seu título aparecer.
- A consulta não altera agendamentos, não cria atendimento, não envia comunicação e não gera cobrança.
- **Faltas por pessoa atendida** consulta agendamentos no estado Orbit `no_show` e agrega por cadastro de pessoa, respeitando a permissão do workspace e a autorização individual do registro relacionado. A interface oferece Hoje, Últimos 7 dias e Últimos 30 dias; a API também aceita intervalo personalizado limitado a 366 dias.

## Decisões conservadoras e limites

- A referência sanitizada mostra quatro agrupadores e confirma as doze combinações de subagrupamento entre categorias distintas com consultas HTTP 200, mas os valores de cada célula não foram lidos. A implementação calcula essas contagens a partir de registros Orbit autorizados. Não afirma equivalência das fórmulas, dos critérios de inclusão ou da transação com o iClinic.
- O critério local de inclusão continua sendo o estado Orbit `completed`; isso é uma definição administrativa do protótipo. A página não permite filtrar por CID nem inclui dados clínicos ou financeiros.
- Para faltas, o critério local é o estado administrativo `no_show` já registrado no agendamento. A referência sanitizada só confirma presets e estados vazios para as datas testadas; fórmula/elegibilidade original não foi observada. O relatório local não afirma equivalência e não converte estados ou cria faltas.
- Datas são interpretadas em UTC. Intervalos personalizados ficam limitados a 366 dias; “Todos” consulta todo o histórico disponível do workspace. Em qualquer modo, o relatório falha se houver mais de 5.000 candidatos, em vez de retornar uma amostra incompleta. “Todos” pode exigir leitura do histórico de agendamentos concluídos; o timestamp permanece em JSON sem índice dedicado, portanto validar desempenho com volume sintético antes de qualquer uso operacional.
- Os cadastros relacionados usam o título atual do registro. O resultado é uma leitura sequencial por registro e não um snapshot transacional; alterações concorrentes podem aparecer em momentos diferentes durante a geração.
- Não há exportação, impressão, comunicação externa nem consulta de elegibilidade. Essas capacidades exigem evidência e permissão específicas.

## Simulação ROOT

Há somente um exemplo sintético e somente de leitura para o papel que possua `plugin.gastro-reports.read`. A simulação não consulta o relatório real nem substitui autorização do endpoint.

## Verificação

- A cobertura unitária valida dependência, permissão de workspace, autorização individual, recusa de referências de outro workspace, quatro agrupadores, doze combinações de subagrupamento, preset Todos sem amostragem parcial, relatório de faltas por `no_show`, ausência de IDs, bloqueio de rótulos sem autorização, limites de período e ausência de escrita operacional.
- Relatórios não foram executados no banco de produto; nenhum serviço foi iniciado para validar a tela visualmente.
