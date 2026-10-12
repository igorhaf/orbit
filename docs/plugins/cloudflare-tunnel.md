# Cloudflare Tunnel

Plugin opcional que administra exclusivamente o binário oficial `cloudflared`. Fica desativado por padrão. Não depende de outros plugins nem publica automaticamente o Orbit, configura DNS, callbacks ou webhooks.

## Instalação e primeira configuração

Instale o binário por uma ação explícita de administração, seguindo a [documentação oficial](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/). O plugin não instala pacotes, executa sudo, altera firewall ou cria serviços systemd.

Em **Plugins → Cloudflare Tunnel → Configurar**:

1. Detecte o executável (`auto` procura no PATH da API; também aceita caminho absoluto).
2. Escolha modo e administrador.
3. Salve a configuração e credenciais.
4. Valide a configuração salva.
5. Ative o plugin e inicie o tunnel.

O plugin usa o mesmo catálogo, ativação, autenticação, `integration_connections` e SecretVault usados pelo Orbit. O registro explícito no módulo da aplicação segue os plugins existentes. Não há contrato global novo de lifecycle ou healthcheck.

## Instalação persistente dos ambientes

Após autorização do administrador, `dev/Dockerfile` inclui o binário da imagem oficial `cloudflare/cloudflared:2026.10.0`, fixado pelo digest `sha256:9b49eed8f62806d5d45ddf59ecefb5710429598ea6d3fcccd2af938f621b2b07`. O binário fica em `/usr/local/bin/cloudflared` e permanece disponível ao recriar a imagem/container. Não há container adicional ou instalação no startup do plugin. O deploy de produção também instala esse mesmo binário na etapa API de `prod/Dockerfile`. A origem para o frontend de produção, vista pelo connector na API, é `http://web-prod:3000`. Ative o connector em PROD e desative o de DEV ao concluir a troca da rota; evite o mesmo tunnel atendendo os dois ambientes simultaneamente. Para publicar o frontend DEV neste mesmo contêiner, configure a origem da rota na Cloudflare como `http://localhost:3001`; a API já é encaminhada pelo frontend. `http://localhost` sem porta usa a porta 80, onde esse ambiente não atende.

Para reconstruir e aplicar essa imagem no DEV, quando autorizado:

```sh
cd /home/meada/projetos/orbit
docker compose build dev
docker compose up -d --no-deps --force-recreate dev
docker exec orbit-dev cloudflared version
```

## Remote Managed

Modo recomendado. Crie o tunnel e configure seus destinos no painel Cloudflare, depois copie seu Tunnel Token para o plugin. O token é criptografado pelo SecretVault com a chave da instalação (`ORBIT_SECRET_KEY`, ou o fallback já existente `JWT_SECRET`). Não aparece no retorno da API; a tela mostra somente a indicação de armazenamento e permite substituição ou remoção explícita.

A execução usa `cloudflared tunnel --no-autoupdate --metrics 127.0.0.1:PORT run`. O token é fornecido em `TUNNEL_TOKEN`, nunca em argumentos, arquivos versionados ou mensagens. O ambiente do processo filho é restrito às variáveis necessárias. Administradores do sistema com acesso ao ambiente do processo ainda podem ler credenciais; preserve as permissões da máquina.

Referência: [parâmetros oficiais](https://developers.cloudflare.com/tunnel/reference/run-parameters/).

## Locally Managed

Informe um YAML existente, por exemplo `~/.cloudflared/config.yml`:

```yaml
tunnel: 00000000-0000-4000-8000-000000000000
credentials-file: /caminho/credenciais.json
ingress:
  - hostname: exemplo.example.com
    service: http://127.0.0.1:4000
  - service: http_status:404
```

O plugin verifica UUID, YAML, credenciais correspondentes, regras ingress e URLs HTTP/HTTPS. Executa `cloudflared tunnel --config ARQUIVO ingress validate` antes de iniciar. Credenciais relativas são resolvidas a partir da pasta do YAML; a execução usa essa mesma pasta. Não sobrescreve arquivos. Configurações com `noTLSVerify: true` são rejeitadas.

Referência: [comandos de tunnels locais](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/tunnel-useful-commands/).

## Quick Tunnel

Modo temporário para desenvolvimento: informe uma origem HTTP/HTTPS, salve, valide e inicie. O plugin captura a URL `https://….trycloudflare.com` emitida pelo binário. URLs com credenciais, parâmetros sensíveis ou portas inválidas são rejeitadas. Autostart é proibido neste modo. Não é usado como fallback de outro modo. Arquivos de configuração padrão do cloudflared podem impedir Quick Tunnels; confira a mensagem do binário e a documentação da versão instalada.

## Configuração

| Campo | Padrão | Limites/função |
| --- | --- | --- |
| tunnelName / tunnelId / publicHostname | vazio | Nome, UUID e domínio de referência; não alteram DNS ou rotas |
| mode | remote | remote, local, quick |
| executablePath | auto | PATH ou caminho absoluto |
| configPath | vazio | YAML existente; modo local |
| quickUrl | http://127.0.0.1:4000 | Origem do modo temporário |
| managedBy | orbit | orbit ou system |
| autoStart | false | Inicialização automática; indisponível em quick |
| restartOnFailure | true | Recuperação de falha do processo próprio |
| restartDelaySeconds | 5 | 1–300 segundos |
| maxRestartAttempts | 5 | 0–20 tentativas |
| restartWindowSeconds | 300 | 10–86400 segundos |
| logLimit | 1000 | 50–1000 linhas |

As opções pertencem à configuração do plugin, não à seção de integrações do core. A configuração é única por instalação e pertence ao usuário que a criou; outros usuários não podem consultá-la ou alterá-la. Pare um processo próprio antes de salvar alterações. Salvar uma configuração válida com autostart habilitado e plugin ativo também inicia o tunnel.

## Lifecycle e propriedade

O serviço usa os hooks Nest já usados pelos plugins. Na carga, lê configuração, verifica habilitação, detecta o binário e reconcilia o processo. Reavalia a habilitação a cada dois segundos. Na desativação ou finalização, encerra graciosamente apenas o processo próprio; usa SIGKILL somente se ele não encerrar e sua identidade continuar comprovada.

`managedBy: orbit` permite controle e captura de stdout/stderr. `managedBy: system` somente observa a presença de um processo externo; não afirma conexão, captura logs ou envia sinais. Um processo externo encontrado impede iniciar um segundo tunnel automaticamente.

A identidade persistida inclui PID, executável real, instante de criação do processo no `/proc` e marcador aleatório no ambiente. Nenhum PID é adotado sozinho. Um lock de sessão PostgreSQL impede dois workers Orbit de controlar a mesma configuração. Após reinício, um processo anterior só é recuperado com identidade completa correspondente. Perda do lock solicita encerramento do processo próprio.

O gerenciamento seguro exige Linux e `/proc` acessível. Em Docker, o binário, YAML e credenciais precisam existir dentro do ambiente da API; processos do host em outro namespace não são observáveis. `127.0.0.1` é o contêiner da API, não o host. Nenhum Compose ou volume é alterado pelo plugin.

## Estados, health e recuperação

`DISABLED`, `NOT_INSTALLED`, `NOT_CONFIGURED`, `STOPPED`, `STARTING`, `CONNECTED`, `STOPPING`, `DEGRADED`, `ERROR`.

Conexão é acompanhada pelos eventos do binário e por `/ready` nas métricas locais, escutando apenas em loopback. Status inclui versão, PID, início, uptime, tentativas, último erro e health do próprio plugin. Não há infraestrutura global nova.

Reinícios automáticos respeitam intervalo e limite dentro da janela. Ao atingir o limite, o plugin entra em erro e aguarda intervenção. Início manual reinicia esse contador. Falhas de carga, validação, execução ou monitoramento não bloqueiam a inicialização do Orbit.

## Logs e troubleshooting

Logs ficam em memória, separados por origem, com limite configurável. Linhas enormes são descartadas e mensagens são limitadas. Tokens, Authorization, secrets, credenciais e URLs com segredos recebem redaction defensivo. Logs anteriores a um reinício do Orbit não são recuperados.

- **Não instalado:** confira o PATH ou caminho do binário no ambiente da API.
- **Configuração incompleta:** salve token ou YAML/credenciais e valide novamente.
- **Falha de autenticação:** substitua o token ou confira as credenciais locais.
- **Degradado:** confira disponibilidade da origem e rede de saída do cloudflared.
- **Outro processo administra o plugin:** aguarde a liberação do lock; não mate processos pelo PID.
- **Processo externo:** use administração pelo sistema; o Orbit não assume seu controle.
- **Erro de persistência:** o início é cancelado e o processo próprio é encerrado para não perder sua propriedade.

Para desativar, use o botão no catálogo ou no painel. O Orbit continua funcionando sem tunnel. Não há gerenciamento de DNS, Access, Workers, Pages, zonas ou comunicação entre plugins.

## Verificações

Unitários, sem conta Cloudflare ou rede externa:

```sh
npm test -w apps/api
```

Integração real explicitamente opcional:

```sh
cd apps/api
ORBIT_CLOUDFLARE_INTEGRATION=1 npx tsx src/cloudflare-tunnel/integration.ts
# Validação opcional de YAML existente:
ORBIT_CLOUDFLARE_INTEGRATION=1 ORBIT_CLOUDFLARE_CONFIG=/caminho/config.yml npx tsx src/cloudflare-tunnel/integration.ts
# Publicação temporária explícita; encerra o processo ao final:
ORBIT_CLOUDFLARE_INTEGRATION=1 ORBIT_CLOUDFLARE_QUICK_URL=http://127.0.0.1:4000 npx tsx src/cloudflare-tunnel/integration.ts
```

O teste quick realiza conexão externa e pode expor a origem informada. Não é executado no CI padrão. Nunca informe tokens reais nos comandos de teste.

O fixture verifica o painel real com API simulada, CSS de build e toque em celular, sem alterar instâncias Orbit:

```sh
ORBIT_NEXT_DIST_DIR=.next-validation/cloudflare-tunnel npm run build
node .orbit/validations/cloudflare-tunnel/cloudflare-tunnel.browser.mjs
```

Use `ORBIT_TEST_CHROME_BIN=/caminho/chrome` se o Chromium de testes não estiver no cache padrão do Playwright. O build isolado modifica os arquivos de tipos/configuração gerados pelo Next; preserve a configuração de desenvolvimento ao executar verificações locais.
