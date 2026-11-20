# Agenda administrativa

## Escopo implementado

- Agendamentos e bloqueios de horário são registros versionados do plugin `gastro-clinic`, isolados por workspace.
- Agendamentos exigem pessoa atendida e profissional ativos, início/fim em ordem e uma finalidade administrativa curta. Podem referenciar procedimento/serviço e convênio cadastrados, ativos e do mesmo workspace. Esses vínculos são opcionais para preservar registros anteriores e porque a evidência não demonstra obrigatoriedade geral; não acionam cobertura, preço, cobrança ou faturamento. O calendário compartilhado mostra somente horário e estado, sem nome, finalidade ou dados de contato.
- Bloqueios avulsos exigem profissional ativo e intervalo positivo. `all_day` é um marcador booleano declarado; não cria ocorrências recorrentes. Descrição é campo protegido e não aparece no calendário.
- Edição cria uma revisão imutável. Cancelamento é uma transição terminal auditável; os eventos cancelados deixam de aparecer na projeção do calendário.
- O menu de situação oferece Agendado, Confirmado, Aguardando atendimento, Não compareceu e Paciente atendido. O estado `completed` conserva a chave persistida anterior e agora usa o rótulo observado “Paciente atendido”. `Não compareceu`, atendimento e cancelamento são estados terminais.
- Cancelamento fica fora do menu de situação. A ação própria exige confirmação e registra um dos motivos observados; “Não excluir” não envia uma solicitação nem altera o registro. A chamada usa a revisão esperada e o histórico normal de transições do Orbit.
- O calendário consulta registros somente depois de verificar a autorização do ator para cada recurso. A projeção inclui apenas ID, workspace, estado, início/fim e, para bloqueios, o booleano de dia inteiro.

## Limites conhecidos

- Recorrência de consultas e bloqueios não está habilitada: a referência não confirmou persistência nem comportamento consistente das séries.
- Não existe regra geral validada de conflito ou disponibilidade. Sobreposições específicas foram aceitas nos ensaios de referência; não são usadas para inferir uma regra universal.
- A referência observou seleção de procedimento e convênio no formulário; a implementação liga esses campos aos catálogos existentes e valida status/escopo. Não modela múltiplos procedimentos, quantidades, elegibilidade do convênio nem regras de faturamento.
- A referência confirma os rótulos do menu e os motivos de cancelamento, mas não a matriz completa de transições entre situações. Para este protótipo, a sequência permitida é conservadora: agendado pode ser confirmado, aguardar, encerrar como falta ou atendimento; confirmado pode aguardar ou encerrar; aguardando pode encerrar. Estados terminais não reabrem. Essa escolha administrativa não cria atendimentos, cobranças, notificações ou efeitos clínicos.
- Agenda não cria cobranças, links de pagamento, comunicação com pessoas atendidas nem conteúdo clínico.
- A agenda clínica do calendário Orbit é somente leitura. Criar e alterar registros ocorre no catálogo `Agendamentos` ou `Bloqueios de horário`, que usa os contratos de registros, ACL e auditoria do Orbit.

## Validação técnica

- Testes direcionados do catálogo, agenda, referências de procedimento/convênio e calendário Gastro: 16/16 aprovados.
- Testes do plugin clínico e calendário: 15/15; teste do registro Core para transições ocultas e ações confirmadas: 2/2.
- Projeção do campo `all_day`: 1/1 em cada um dos seis runtimes.
- Builds de API e verificação de compatibilidade de plugins: seis runtimes aprovados.
- Não houve acesso a banco operacional nem validação visual assistida nesta etapa.
