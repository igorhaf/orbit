# Ciclo administrativo de atendimento

O plugin `gastro-clinic` oferece um registro de atendimento ligado a uma pessoa atendida e a um profissional ativos do mesmo espaço. O registro começa em `Em andamento` e pode ser finalizado uma única vez; a versão final fica imutável no histórico de registros Orbit.

Este escopo corresponde ao ciclo observado em fixture sintética no material de referência, em que iniciar e finalizar persistiram após recarga com a opção inicial “Não assinar”. A implementação não recolhe nem salva anotação clínica, queixa, exame, diagnóstico, conduta, prescrição ou assinatura. O rótulo final explicita que não houve assinatura.

O acesso usa `plugin.gastro-clinic.write` e os contratos existentes de records versionados, escopo do workspace, auditoria e validação de referências. Um registro sem pessoa ou profissional ativo, do mesmo espaço e produto, é recusado.

Não há suporte nesta etapa para edição após finalização, reabertura, cancelamento, assinatura, concorrência de dois profissionais, adendos ou vínculo automático com agendamento. Esses comportamentos não foram comprovados pelas referências e permanecem fora do fluxo.

Dados demonstrativos ROOT são somente leitura e sintéticos; não representam atendimento real.
