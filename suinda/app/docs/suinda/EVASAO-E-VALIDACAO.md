# Evasão e sinais de acompanhamento

## Comportamento disponível

O painel não calcula nem exibe uma probabilidade de evasão. Ele apresenta dois sinais operacionais que podem orientar uma conversa da equipe acadêmica:

1. **Frequência abaixo do mínimo**: compara minutos de presença registrados com minutos previstos em encontros concluídos da mesma revisão curricular, e confronta o percentual com o mínimo configurado no curso. Encontros cancelados, futuros ou sem datas válidas não compõem o denominador. O cálculo não afirma a causa da ausência nem se a matrícula será encerrada.
2. **Reprovação sem tentativas restantes**: para matrícula ativa, compara a última tentativa corrigida com a nota mínima e o limite de tentativas da avaliação. Tentativas ainda não corrigidas não são classificadas; uma tentativa posterior aprovada remove o sinal.

Os valores são exibidos como critérios e medidas de origem, sem score composto, ordenação por risco ou decisão automatizada. Pagamentos pendentes, documentos vencendo, inscrições e capacidade de turma permanecem indicadores operacionais separados e não são usados como variáveis de um classificador. Esses sinais não devem, isoladamente, fundamentar restrição de acesso, desligamento ou outra decisão adversa.

## Modelo preditivo: não habilitado

A especificação menciona identificar evasão por desempenho. Um modelo que transforma histórico em previsão não pode ser definido responsavelmente sem decisão institucional sobre o que significa evasão, quais estudantes e períodos entram na análise e quais intervenções a previsão pode orientar. Portanto, nenhum modelo de previsão, limiar, alerta probabilístico ou recomendação automática está ativo.

Antes de projetar ou habilitar esse recurso, a instituição deve aprovar e documentar:

- definição operacional do desfecho (por exemplo, desistência formal versus inatividade), horizonte de previsão e tratamento de transferência, pausa, conclusão e matrícula recém-iniciada;
- população e períodos elegíveis, origem e qualidade dos rótulos e prevenção de vazamento temporal;
- variáveis permitidas, finalidade, base legal, minimização, exclusões de dados sensíveis/proxies e acesso aos registros individuais;
- intervenção humana permitida, comunicação ao estudante, contestação/correção de dados e proibição de decisão adversa exclusivamente automatizada;
- métricas e critérios mínimos de validação temporal externa, calibração, falsos positivos e falsos negativos, desempenho por subgrupos relevantes, robustez e comparação com uma regra simples;
- responsável acadêmico, revisão independente, aprovação de privacidade/jurídico, versionamento do modelo, monitoramento de deriva, periodicidade de reavaliação, retenção e procedimento de suspensão/rollback.

Uma implementação futura deve apresentar os fatores observados, período e dados faltantes de modo legível, registrar versão e motivo do alerta para auditoria e permitir avaliação humana. Uma validação inicial não substitui monitoramento posterior nem aprovação institucional para uso operacional.

## Estado da pendência

As regras operacionais descritas acima estão disponíveis. O requisito de **previsão de evasão por desempenho continua pendente** até que a instituição aprove definição, dados, finalidade, salvaguardas e protocolo de validação. Não preencher essas escolhas com valores padrão é intencional: são decisões acadêmicas e de governança, não parâmetros neutros de implementação.
