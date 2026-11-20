# Dropbox

Orbit conecta uma conta Dropbox via OAuth e conserva os tokens somente no cofre criptografado do backend. Arquivos continuam no Dropbox: o Orbit armazena apenas seus identificadores, metadados mínimos e, quando solicitado, um link compartilhável.

## Configuração

1. Crie um app OAuth em [Dropbox App Console](https://www.dropbox.com/developers/apps).
2. Escolha o nível de acesso adequado: **Full Dropbox** permite localizar arquivos existentes; **App Folder** limita a integração à pasta do app.
3. Em **Permissions**, habilite `account_info.read`, `files.metadata.read`, `sharing.read` e `sharing.write`.
4. Registre exatamente `DROPBOX_REDIRECT_URI` como redirect URI e configure `DROPBOX_CLIENT_ID` e `DROPBOX_CLIENT_SECRET` somente no ambiente da API.
5. Reinicie a API e conecte a conta em **Perfil → Integrações**.

A integração usa tokens de acesso curtos e refresh token (`token_access_type=offline`). O acesso pode ser revogado no Dropbox a qualquer momento; nesse caso, reconecte a conta no Orbit.

## Operações

O catálogo de plugins expõe listar pasta, buscar arquivos, obter metadados e criar link compartilhável. Para vincular um arquivo a um cartão, faça `POST /dropbox/cards/:cardId/link` com `connectionId` e `path`; o arquivo aparece em Recursos externos do cartão.
