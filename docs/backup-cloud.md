# Backup local e Google Drive

Na instalação containerizada, `ORBIT_ENV=development` separa os novos envios em pastas com prefixo **Orbit DEV**: **Orbit DEV Backups**, **Orbit DEV Vault Backups**, **Orbit DEV Config Backups** e **Orbit DEV Card Attachments**. Os nomes abaixo sem o prefixo descrevem a instalação fora do contêiner ou PROD. A conta Google pode ser a mesma, mas os arquivos novos não se misturam entre ambientes.

O Orbit cria e verifica backups criptografados separados do banco, do cofre, dos arquivos de configuração e dos anexos dos cartões. Em **Backups**, selecione a conta Google para o envio automático. Com uma única conta Drive conectada, ela é usada automaticamente; se houver várias, escolha uma na página. Com o envio automático ativo, cada geração de backup manual, pela CLI ou antes de uma migração envia os pacotes ao Drive. Se um envio falhar, os arquivos locais continuam disponíveis e podem ser reenviados.

O botão **Só cofre** gera um novo pacote do cofre sem executar `pg_dump`; com o envio automático ativo, ele é enviado para a mesma conta Drive.

O Orbit observa os arquivos `.env`, `.env.local` e variantes locais nos diretórios do projeto, `apps/api` e `apps/web` a cada 30 segundos. Alterações feitas pela interface de configurações geram o backup imediatamente. Outros arquivos ignorados pelo Git podem ser incluídos com `ORBIT_CONFIG_BACKUP_PATHS`, uma lista de caminhos relativos ao projeto separados por vírgulas ou linhas. Quando o repositório Git está presente, o Orbit exige que cada caminho adicional esteja ignorado. Links simbólicos são recusados e há limite de 1 MB por arquivo e 5 MB por pacote. O pacote vai para a pasta **Orbit Config Backups** sem gravar os segredos em claro no Drive. A interface mostra o status do envio e permite reenviar ou baixar e verificar.

Os anexos de arquivo dos cartões e dos comentários ficam em colunas `bytea` do PostgreSQL, não em arquivos do repositório. O backup completo do banco já inclui esses dados. Para recuperação individual, o Orbit cria um pacote criptografado por anexo, guarda-o em `backups/attachments/` e o envia ao Drive quando o envio automático está ativo. A hierarquia é **Orbit Card Attachments → Quadro [ID] → Cartão [ID] → Arquivos do cartão / Anexos dos comentários**. Os títulos facilitam encontrar o arquivo; os IDs e metadados internos identificam cada pasta de forma estável. O Orbit atualiza o nome das pastas ao reutilizá-las após uma mudança de título. Cópias antigas na raiz são movidas para o cartão correspondente durante a sincronização, sem reenviar os dados. Se o cartão foi excluído, elas vão para **Cartões sem quadro → Cartão removido [ID]**. Anexos novos são enviados após a gravação; uma varredura a cada 30 segundos tenta novamente os envios pendentes e cobre anexos anteriores. A tela **Backups** mostra os resultados, o caminho no Drive e permite reenvio e download. A varredura processa lotes de até 20 anexos por vez; o botão manual processa até 100.

Quando a retenção remove uma cópia local, a cópia remota continua na lista. Use **Baixar do Drive** para recuperar e verificar o arquivo antes de restaurar. O backup do cofre pode ser importado para uma conta existente sem restaurar o banco inteiro; itens existentes são preservados e o mesmo arquivo não é importado duas vezes para a mesma conta. A chave `ORBIT_BACKUP_KEY` é necessária para abrir os dois tipos de backup. Guarde-a fora do servidor junto com o procedimento de recuperação.

## Configuração

1. Aplique as migrações com `npm run db:migrate` para criar os registros das cópias remotas e da configuração automática.
2. Em **Perfil → Integrações**, configure `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` para o núcleo Google compartilhado, além de `ORBIT_SECRET_KEY` para proteger o refresh token e `ORBIT_BACKUP_KEY` para os arquivos de backup. As variáveis próprias do Drive ficam em **Plugins → Google Drive → Configurar**.
3. No cliente OAuth do Google, cadastre a URI `${API_PUBLIC_URL}/google/drive/oauth/callback` (ou o valor explícito de `GOOGLE_DRIVE_REDIRECT_URI`, configurado no plugin) como URI de redirecionamento. [Habilite a Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com) no mesmo projeto do cliente OAuth; sem essa etapa o Google retorna `403 accessNotConfigured`.
4. Em **Backups**, clique em **Conectar conta Google**. O Orbit pede acesso offline e somente o escopo `drive.file`. O plugin cria as pastas **Orbit Backups**, **Orbit Vault Backups**, **Orbit Config Backups** e **Orbit Card Attachments** nessa conta. Cada pasta recebe arquivos criptografados e seus manifestos.
5. Em **Envio automático ao Google Drive**, escolha a conta e salve. Com uma única conexão Drive, o envio automático já é o padrão. O backup manual, a CLI e o backup pré-migração usam a mesma conta.

O [escopo `drive.file`](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) limita o plugin aos arquivos que ele criou ou que foram compartilhados com o aplicativo. A API usa [upload retomável](https://developers.google.com/workspace/drive/api/guides/manage-uploads) e confirma tamanho e MD5 do arquivo recebido. O Orbit ainda verifica o SHA-256 e a autenticação AES-GCM durante a recuperação.

## Arquitetura

`createDatabaseBackup` permanece independente de provedores e produz a cópia local. `BackupDestinationRegistry` aceita provedores adicionais; `GoogleDriveBackupPlugin` implementa upload e download. `GoogleCredentials` é o núcleo compartilhado para OAuth, tokens criptografados, renovação e verificação de escopos. Drive e Gmail usam esse núcleo, e Calendar aceita conexões Google compartilhadas com escopos de calendário; as conexões antigas continuam válidas.

Os registros `backup_cloud_copies`, `vault_backup_cloud_copies`, `config_backup_cloud_copies` e `attachment_backup_cloud_copies` guardam proprietário, conta, status e IDs remotos, sem guardar tokens. `backup_cloud_settings` fixa a conta de envio automático. A escolha de conta é validada no servidor antes do envio e novamente no download. Desativar o plugin `google_drive` impede operações remotas e mantém o backup local disponível.

O arquivo do cofre contém categorias, títulos e textos, todos dentro de um envelope AES-256-GCM próprio. A chave é derivada de `ORBIT_BACKUP_KEY` com contexto exclusivo para o cofre. Nenhum texto do cofre é gravado em claro no disco durante a criação do pacote. A importação recriptografa os itens com a chave do cofre do destino. Para recuperação independente após perder o banco, baixe os arquivos de **Orbit Vault Backups**, configure `ORBIT_BACKUP_KEY` e execute `npm run db:backup -- restore-vault /caminho/orbit-vault-....vault.enc usuario@exemplo.com` depois de criar a conta de destino.

O pacote de configurações também usa AES-256-GCM com uma chave derivada de `ORBIT_BACKUP_KEY` em contexto exclusivo. O manifesto público contém contagem e hashes, sem nomes ou valores de variáveis. Para recuperar, baixe o `.config.enc` e seu `.manifest.json` da pasta **Orbit Config Backups**, configure a `ORBIT_BACKUP_KEY` original a partir de uma cópia guardada fora do servidor e execute:

```bash
npm run db:backup -- verify-config /caminho/orbit-config-....config.enc
npm run db:backup -- restore-config /caminho/orbit-config-....config.enc /pasta/vazia/de/recuperacao
```

A restauração preserva os caminhos relativos e recusa sobrescrever arquivos existentes. Verifique o conteúdo na pasta de recuperação e copie os arquivos desejados para a instalação. A chave `ORBIT_BACKUP_KEY` pode estar dentro do próprio `.env`, mas esse pacote não consegue abrir a si mesmo sem a cópia da chave guardada fora do servidor. Mantenha essa cópia em um gerenciador de senhas ou outro cofre independente. Arquivos de configuração continuam ignorados pelo Git.

Para recuperar um anexo individual, baixe o par `.attachment.enc` e `.manifest.json` da pasta **Orbit Card Attachments**, configure a `ORBIT_BACKUP_KEY` original e execute:

```bash
npm run db:backup -- verify-attachment /caminho/card-....attachment.enc
npm run db:backup -- extract-attachment /caminho/card-....attachment.enc /pasta/de/recuperacao
```

O comando extrai o arquivo original com permissão restrita e não sobrescreve um arquivo existente. Ele não altera cartões nem comentários; reanexe o arquivo pela interface se necessário.

Se o banco principal for perdido por completo, a lista de cópias e as credenciais OAuth também precisarão ser recuperadas de outro lugar. Nesse caso, baixe manualmente os dois arquivos da pasta **Orbit Backups** no Google Drive e use a `ORBIT_BACKUP_KEY` original para verificar e restaurar o arquivo. A recuperação pela interface requer o banco e a conexão Google ainda disponíveis.

As variáveis legadas `ORBIT_DRIVE_*` não são necessárias para o envio automático. A conexão Google compartilhada é usada pela interface, pela CLI e pelas migrações. Nenhuma conexão com uma conta Google real é feita pela suíte automatizada; os testes usam respostas simuladas da API, e a integração com PostgreSQL valida a restauração separada do cofre.
