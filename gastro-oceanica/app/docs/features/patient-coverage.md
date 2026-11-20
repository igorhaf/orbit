# Convênios, planos e vínculo administrativo de cobertura

O plugin `gastro-clinic` armazena convênios, planos e coberturas como registros Orbit versionados, isolados por workspace e sujeitos às permissões de leitura e escrita do registro.

## Fluxo implementado

- Cadastre um convênio ativo com código interno, nome e descrição opcional.
- Cadastre um plano ativo ligado a um convênio ativo.
- Cadastre um vínculo de cobertura apontando para uma pessoa atendida ativa e um convênio ativo.
- O plano é opcional. Se informado, precisa estar ativo e pertencer ao convênio escolhido.
- Inative e reative registros pelos estados versionados; o histórico de versões é preservado.
- O código do beneficiário é um campo sensível e passa pelo protetor de dados do Orbit. Sem chave válida, a gravação protegida falha fechada.

O contexto de validação do plugin resolve as referências somente dentro do workspace corrente e aplica autorização de leitura antes de retornar seus dados. Referências inexistentes, de outro tipo, inativas, não autorizadas ou de outro workspace são recusadas.

## Fronteiras

Este é um cadastro administrativo sintético. Não consulta operadoras nem valida elegibilidade, cobertura de procedimentos, carência, autorização ou validade contratual. Não aciona agenda, atendimento, contas a receber, faturamento, TISS ou comunicação. A referência iClinic observada registra campos de convênio e plano no cadastro, mas não confirma regras de persistência, elegibilidade ou efeitos em outros módulos; por isso, esses efeitos não foram presumidos.
