# Cadastro administrativo de profissionais

O tipo `professional` do plugin `gastro-clinic` mantém o nome e os vínculos operacionais usados por agendamentos, bloqueios e atendimentos. O formulário também aceita e-mail, CPF, celular, número do conselho, RQE e CNES, campos observados no perfil profissional sanitizado de referência.

Esses campos adicionais são opcionais. A referência mostra os controles, mas não comprova obrigatoriedade, validações de servidor, unicidade, emissão/consulta de registros ou integração com conselhos e cadastros externos. O protótipo limita-se ao formato de e-mail e aos tamanhos máximos locais. Não faz consulta externa nem declara validade profissional.

Nome, e-mail, CPF, celular, conselho, RQE e CNES são protegidos com o mecanismo de cifra do Orbit antes da persistência. A chave ausente mantém a escrita protegida bloqueada. `password` e `confirmPassword` observados no próprio perfil de conta não são copiados para o cadastro de domínio nem usados para alterar autenticação.

O registro profissional não concede permissões de usuário. `team` e `specialty_id` são metadados organizacionais; acesso continua sob as permissões e ACLs do Orbit. Só profissionais ativos habilitados para agenda podem ser usados pelos vínculos de agenda conforme as validações do plugin.

Os exemplos de simulação ROOT permanecem fictícios e somente de leitura. Não há envio de comunicação nem escrita em cadastro de usuário.
