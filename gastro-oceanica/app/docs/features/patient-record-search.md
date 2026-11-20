# Busca no cadastro de pessoas atendidas

O cadastro de pessoas atendidas aceita busca por código, nome, CPF e telefones. Esses campos são declarados como `searchableFields` no tipo `patient` do plugin `gastro-clinic`; outros tipos e plugins não passam a pesquisar conteúdo de forma implícita.

## Comportamento

- A busca é enviada ao endpoint de listagem do plugin e percorre registros até encontrar 100 correspondências ou terminar o workspace.
- A pesquisa ignora acentos e diferenças de pontuação em identificadores como CPF e telefone. Exige ao menos dois caracteres e aceita até 120.
- O título do registro continua pesquisável; campos adicionais precisam ser declarados pelo plugin e ser strings de primeiro nível do schema.
- A autorização do registro é verificada antes da descriptografia e comparação de qualquer payload. Candidatos sem acesso não são retornados nem descriptografados; todos os registros autorizados examinados geram evento de auditoria, mesmo quando não correspondem ao termo.
- Campos sensíveis continuam cifrados em repouso. A comparação acontece apenas na memória do servidor após autorização.

## Associação administrativa com profissionais

O cadastro permite associar uma pessoa atendida a até 100 profissionais ativos do mesmo workspace. A lista de pessoas atendidas tem um filtro multisseleção por profissional; selecionando vários nomes, a lista inclui registros associados a qualquer um deles. A associação só organiza os cadastros: não modifica agenda, atendimento, permissões clínicas ou faturamento. Os IDs associados são tratados como dado sensível e protegidos em repouso; referências inválidas, inativas ou de outro produto são recusadas.

Essa regra é uma decisão de produto para o protótipo: a evidência iClinic disponível confirma o controle visual multisseleção, mas não demonstra semântica equivalente no servidor. Portanto, a implementação não afirma paridade com regra interna da referência.

## Limites

A interface continua mostrando no máximo 100 registros por busca, em ordem dos mais recentes. Buscas sem correspondências podem percorrer o histórico autorizado completo do workspace; dimensões muito grandes precisam de medição e possível estratégia de índice que preserve a proteção dos campos.

O endpoint retorna no máximo 100 registros por página e a interface carrega até 100 opções por tipo referenciado. Para workspaces maiores, ainda é necessário avaliar paginação de opções e custo de buscas que varrem o histórico completo.
