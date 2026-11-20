# Cadastro administrativo de pessoas atendidas

O plugin `gastro-clinic` reutiliza os registros versionados e os formulários Orbit para manter cadastros de pessoas atendidas no workspace autorizado.

## Campos

O formulário organiza os campos em abas de **Dados pessoais** e **Dados complementares**, seguindo a separação observada nas referências. A aba pessoal reúne identificadores, nomes, sexo conforme as opções documentadas, gênero social, data de nascimento, CPF/RG, e-mail, telefones, origem da indicação e consentimento para lembretes. A aba complementar contém endereço, dados demográficos, pessoa relacionada, observações e antecedentes opcionais separados. Ao alternar as abas, os valores informados permanecem no mesmo formulário e são enviados na mesma revisão do registro.

O cadastro aceita contatos de celular, residência ou trabalho e exige ao menos um telefone; e-mail é opcional e validado pelo controle de formato.

O formulário não envia SMS: autorização para lembretes começa desativada. Opções demográficas refletem os valores encontrados nas referências disponíveis; não são inferidas para além dessas listas.

## Privacidade e validação

Nome, identificadores, meios de contato, endereço, data de nascimento, dados demográficos e antecedentes são campos sensíveis do registro. O Orbit cifra esses campos antes da persistência e falha fechado quando a chave de proteção não está configurada. As permissões de leitura e escrita continuam verificadas por registro e workspace.

A data precisa ser uma data de calendário real e não pode estar no futuro. Não há uma regra nova de unicidade para e-mail/CPF/RG. A inativação usa o estado versionado do registro; não apaga histórico nem modifica agendamentos.

## Convênios e planos

Convênios, planos e vínculos de cobertura são registros administrativos separados do payload da pessoa atendida. Um vínculo aponta para uma pessoa ativa e um convênio ativo do mesmo workspace; o plano é opcional, mas, quando informado, precisa pertencer ao convênio selecionado. O código do beneficiário é protegido como campo sensível.

Esse vínculo não confirma elegibilidade, cobertura de procedimento, validade perante o convênio, autorização, faturamento ou efeito em agendamentos/atendimentos. Não há consulta a operadoras. Use somente dados sintéticos durante desenvolvimento.

## Limites

Este é um cadastro administrativo. Não cria prontuário longitudinal, prescrição, diagnóstico ou conduta clínica. O modelo separado preserva a possibilidade de múltiplos vínculos versionados sem presumir que exista uma única cobertura atual.
