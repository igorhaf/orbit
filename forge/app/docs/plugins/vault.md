# Cofre opcional e credenciais de integrações

O plugin `vault` é responsável pelos cadernos criptografados do Cofre, categorias, cópia em Markdown para cartões e backup separado do Cofre. As permissões `vault.read` e `vault.write` pertencem a esse plugin.

A resolução de credenciais pertence ao core, em `credential-store.ts`. Referências persistidas `orbit-vault://` mantêm seus identificadores e valores criptografados; não dependem da interface ou da instalação do plugin. O catálogo autenticado `GET /account/credential-constants` retorna apenas metadados da própria conta, sem valores secretos. Integrações e seus selects utilizam esse caminho. `vault-credentials.ts` e `VaultConstantSelect` são adaptadores de compatibilidade para importações existentes.

## Disponibilidade

- A tabela genérica `plugin_installations` controla quais módulos estão instalados por instância; ausência de registro preserva a instalação existente.
- `installed=false` remove o plugin do catálogo e impede sua ativação pelo toggle de plugins. Desativação comum preserva a instalação.
- Retirar uma base suspende seus dependentes, preservando o estado desejado. Reinstalar uma base não ativa um dependente que tenha sido explicitamente desativado.
- Menus desktop e mobile, rota do Cofre, compartilhamento por workspace e seção de backup separado usam a mesma disponibilidade efetiva.
- As rotas `/vault`, `/cards/:id/vault` e `/backups/vault` também são bloqueadas no backend, inclusive para ROOT. O serviço de CRUD e os métodos de backup verificam disponibilidade em chamadas internas.
- O backup geral do banco, configurações e anexos continua independente do plugin. Com o Cofre indisponível, o worker não gera nem envia seu backup separado.

## Preservação dos dados

Desinstalar o módulo não apaga `vault_items`, categorias, compartilhamentos existentes, backups históricos, referências de credenciais ou chaves de criptografia. Isso evita interromper integrações e permite reversão. Restrições de privacidade para cartões legados no Cofre permanecem no core. Não exclua tabelas ou altere a chave de criptografia para remover a interface.

A migration genérica 142 acrescenta o controle de instalação e preserva o Cofre nos ambientes existentes. Uma decisão de remoção de cliente deve ser aplicada somente no checkout/banco desse cliente, sem alterar o padrão de DEV e PROD.

## Validações

`vault.spec.ts` cobre catálogo, dependentes, permissões, bloqueio de rotas/chamadas internas e independência dos backups. `vault.integration.spec.ts` cobre CRUD criptografado, cópia em Markdown, compartilhamento, remoção/reinstalação e resolução de referências em PostgreSQL isolado. Não execute testes de navegador neste host sem nova autorização explícita.
