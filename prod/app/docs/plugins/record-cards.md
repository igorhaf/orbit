# Cartões nativos de registros

`record-cards` depende de `versioned-records`. Um plugin opta por contribuir `recordCards` para um tipo de registro. O vínculo idempotente usa os cartões, comentários, anexos, checklist, datas, atividades e editor nativos; documentos e transições formais continuam em seus registros originais.

Por padrão, cada registro tem uma área técnica isolada de colaboração que não aparece como quadro adicional nem entra em pesquisas globais. O plugin pode optar por expor um quadro nativo com escopo fixo, conforme a contribuição descrita abaixo. Listagens autorizadas e calendário são providos pelo adaptador com conferência de acesso a cada registro e a suas referências sensíveis. Revogações e plugins desativados bloqueiam chamadas diretas também para ROOT.

Não há cópia de credenciais nem de documentos cegados nos cartões. Referências de títulos são autorizadas antes de revelar o nome do curso. Movimentação, compartilhamento do quadro técnico e cópia em massa não substituem as permissões dos registros. Arquivar ou mudar a fase formal exige o fluxo do plugin. O histórico operacional é separado do histórico imutável das decisões.

O cabeçalho do Orbit é compartilhado com todos os perfis; o motor de permissões continua responsável pelas operações. `AccessShell` e `ExtensionPage` podem ser embutidos em painéis sem criar uma segunda aplicação. A visão geral reutiliza os cartões autorizados e o calendário nativo inclui seus agendamentos através de um provedor suplementar genérico.


## Quadros visíveis com escopo fixo

Uma contribuição `recordCards` pode declarar `board: {visible:true,fixedScope:true,phases,templates}`. Sem essa declaração, mantém-se a área interna privada descrita acima. Com ela, o provedor de listagem expõe um quadro nativo apenas aos usuários autorizados no registro original e nas referências de título; a exclusão SQL das áreas internas é preservada.

`boardCreators` contribui entradas de criação específicas, filtradas por plugin e privilégio, sem exigir ativar a criação livre de projetos/quadros. O adaptador de domínio cria o registro pelo serviço versionado existente e solicita a projeção idempotente.

`GET /record-cards/boards/:id` retorna escopo, fases e modelos. `POST /record-cards/boards/:id/templates/:template` aceita apenas `operation_key` UUID e cria cartão, checklist e pai principal em uma transação. A repetição da chave retorna o mesmo cartão. Nomes, descrições e fases vêm da contribuição, nunca do corpo enviado pelo cliente.

As tabelas `record_board_phases` e `record_board_template_uses` preservam identidades e idempotência. Um trigger genérico projeta mudanças do estado versionado para a lista do cartão principal atomicamente. Não cria transições nem autoriza operações formais.

Listas são fixas, o cartão principal não pode ser movido ou removido pelas operações de cartões e entradas de outros quadros são rejeitadas. Atividades podem mudar somente entre fases do próprio quadro. Modelos aparecem na lateral, substituindo Coleções nesse quadro, e no cabeçalho em dispositivos móveis. Desativar o adaptador ou `record-cards` suspende listagem, leitura e mutações sem apagar dados.
