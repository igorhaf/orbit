# Memória dos ambientes de desenvolvimento

Estas ferramentas medem os ambientes mantendo compilação sob demanda e observação de código. Não iniciam navegadores. Execute medições e verificações pesadas em sequência; não rode dois benchmarks, builds ou suítes completas ao mesmo tempo neste host.

## Coleta por 48 horas

`monitor.py` registra metadados do host, contêineres Docker e serviços de usuário `adope-api`/`adope-web`: RAM, swap, pressão de memória/I/O, contadores de paginação, CPU, processos, limites, eventos e saúde. O Docker é inspecionado em lote com uma lista explícita de campos. A coleta não lê variáveis de ambiente, credenciais, conteúdo de aplicações, comandos dos processos ou respostas HTTP.

```sh
python3 tools/dev-runtime/monitor.py \
  --output /home/meada/projetos/orbit/control/state/ram-20261101/samples.jsonl \
  --interval 60 --duration 172800
```

`--duration` e `--interval` usam segundos; os padrões são 48 horas e um minuto. `--once` grava uma única amostra. Erros de leitura são registrados sem encerrar a coleta; subprocessos têm timeout. SIGTERM/SIGINT encerram o loop. Os arquivos JSONL novos são criados com permissão `0600`, giram aos 32 MiB e mantêm três backups, com até aproximadamente 128 MiB por destino.

O template `monitor.service` pode ser revisado e copiado manualmente para `~/.config/systemd/user/`. Os caminhos refletem este host e o diretório de medição desta intervenção. Ele limita somente o coletor a 128 MiB e 10% de um núcleo, com prazo máximo de 49 horas. Sua presença no repositório não instala, inicia ou habilita o serviço; nenhuma inicialização automática é configurada pelas ferramentas.

## Benchmark sequencial e recarga de fonte

```sh
python3 tools/dev-runtime/benchmark.py \
  --url http://127.0.0.1:3001 \
  --routes / /boards /calendar \
  --label dev-conserve \
  --output /home/meada/projetos/orbit/control/state/ram-20261101/benchmarks.jsonl \
  --samples-output /home/meada/projetos/orbit/control/state/ram-20261101/benchmark-samples.jsonl \
  --probe-root /home/meada/projetos/orbit/forge/app/apps/web/app \
  --idle-seconds 20
```

Escolha rotas adequadas e autorizadas para cada aplicação. O benchmark faz GET das rotas em ordem, uma primeira passagem e duas passagens aquecidas. Cada requisição tem timeout de 60 segundos. Registra status, duração e hash da resposta, sem salvar HTML; mede memória antes e depois das etapas e após o repouso final. O rótulo `cold` significa somente a primeira passagem da execução: não implica cache fisicamente frio, processo novo ou cache limpo.

`--probe-root` é opcional e deve apontar para `apps/web/app`. O teste cria exclusivamente `dev-memory-probe/page.tsx`, confirma um marcador, altera a fonte e confirma outro marcador via HTTP. Aborta se a rota já existir. No encerramento, inclusive por interrupção, remove somente o arquivo criado e tenta remover seu diretório vazio; arquivos alheios são preservados. Não usa prefixo `_`, pois o Next trata esses diretórios como privados. Essa verificação comprova recarga de fonte no servidor; não comprova Fast Refresh ou preservação de estado no cliente, que exigiriam navegador. Selenium/Chrome continuam desautorizados neste host.

## Resumo dos resultados

```sh
python3 tools/dev-runtime/summarize.py \
  --state-dir /home/meada/projetos/orbit/control/state/ram-20261101 \
  --output-prefix benchmark-summary
```

Lê `benchmarks.jsonl` e `benchmark-samples.jsonl`, incluindo arquivos rotacionados, e gera `benchmark-summary.json` e `.md`. O diretório padrão é o atual; um prefixo relativo é resolvido dentro de `--state-dir`. Uma linha final incompleta produz um aviso, sem expor seu conteúdo.

Os alvos são `suinda-web`, `orbit-dev`, `orbit-safdoulas-v2-web` e `adope-web.service`; a API Adope também aparece separadamente. O contêiner `orbit-dev` inclui API e processos filhos, portanto não é diretamente equivalente aos alvos que contêm apenas um frontend.

`working_set_bytes` é `memory.current - inactive_file`. O pico bruto `memory.peak` pertence à vida do cgroup, inclui cache e pode anteceder o benchmark; não equivale ao maior working set amostrado nem ao heap JavaScript. O máximo amostrado pode perder picos entre leituras. Memória anônima vem de `memory.stat.anon`; swap é apresentada separadamente. Eventos OOM/max são contadores absolutos finais, sem atribuição automática à janela do teste. A mediana warm considera respostas 200; a duração de reload v2 é a requisição HTTP bem-sucedida e não inclui amostragem, esperas e tentativas anteriores.

## Política de memória e rollback

Nos checkouts de desenvolvimento, `ORBIT_DEV_MEMORY_MODE=standard` restaura a política padrão do Turbopack para comparação. Sem essa opção, a configuração de desenvolvimento habilita cache persistente, `turbopackMemoryEviction: 'full'` e `turbopackGc: true`. São opções experimentais; descarte mais frequente pode trocar RAM por leituras de disco e recompilação. Elas não definem um teto de memória e só têm efeito com Turbopack e cache persistente. As configurações de compilação em produção não recebem essas opções pela condição `NODE_ENV === 'development'`.

Os scripts web `dev:turbopack` e `dev:webpack` permitem comparação sem executar os dois simultaneamente. Defina `ORBIT_NEXT_DIST_DIR` diferente por compilador/cenário para separar artefatos e use a mesma variável nas etapas de um mesmo cenário. Alterar variável de um contêiner existente exige atualizar sua configuração e reiniciar o processo apropriado; exportar no terminal do host não altera um processo já iniciado. Na Adope, as variáveis equivalentes são `ADOPE_DEV_MEMORY_MODE` e `ADOPE_NEXT_DIST_DIR`.

As primeiras medições curtas, ainda sem validação de 48 horas, mostraram aproximadamente:

| Alvo | Turbopack padrão, WS final MiB | Turbopack com descarte completo, WS final MiB | Webpack, WS final MiB |
|---|---:|---:|---:|
| Suinda web | 696 | 681 | 1998 |
| Orbit Dev, incluindo API | 787 | 783 | ainda não consolidado |

São fotografias preliminares. A diferença pequena entre as duas políticas Turbopack não demonstra ganho sustentado. Uma redução grande em relação ao processo antigo também envolve reinício, idade do processo e rotas compiladas; não atribua toda a redução à política. A consolidação JSONL e a observação prolongada são a referência para a decisão final.

## Serialização de builds e testes

O watcher da API aceita `ORBIT_DEV_BUILD_LOCK`. Quando definida, envolve a compilação com `flock --exclusive`; quando ausente, mantém a execução original. As guardas que aguardam execuções de cartões ficarem livres antes de recompilar/reiniciar permanecem ativas.

O arquivo do host é `/home/meada/projetos/orbit/control/state/dev-locks/build.lock`. O diretório deve ser montado nos contêineres como `/run/orbit-dev-locks`, e a variável deve apontar para `/run/orbit-dev-locks/build.lock`. Todos precisam acessar o **mesmo inode** pelo bind mount; nomes iguais em sistemas de arquivos diferentes não compartilham o lock. `flock` precisa estar instalado nas imagens. Não substitua o arquivo de lock enquanto houver processos esperando ou segurando seu inode.

Verificações manuais também precisam usar esse lock, uma por vez, a partir da raiz do checkout:

```sh
DEV_BUILD_LOCK_HOST=/home/meada/projetos/orbit/control/state/dev-locks/build.lock
flock --exclusive "$DEV_BUILD_LOCK_HOST" npm run build
flock --exclusive "$DEV_BUILD_LOCK_HOST" npm run test:unit
```

Os comandos acima são sequenciais. Dentro de um contêiner, use o caminho montado `/run/orbit-dev-locks/build.lock`. As suítes da API Dev e Suinda usam `--test-concurrency=1`. Nesta validação, a suíte Safdoulas também foi executada explicitamente com concorrência 1, sem modificar seu manifesto observado pelo processo antigo da API. O lock coordena verificações e builds do watcher; não serializa todos os compiladores Next automaticamente. Não faça builds integrais ou benchmarks concorrentes.

## Preservação e pendências

Checkpoints anteriores aos ajustes: Orbit Dev `0af89b2`, Orbit main `c91e4c7`, Suinda `8a747ba`, Safdoulas V2 `33d5c79`; Adope `11fc114` somente local, conforme autorizado. O checkpoint do código de produção preservou suas alterações existentes; não representa deploy de novas funcionalidades.

No levantamento anterior ao ajuste havia três migrações pendentes no Dev, quatro no Safdoulas V2 e nenhuma no Suinda. Nenhuma dessas migrações foi aplicada por este ajuste de memória. Não use restart do entrypoint como substituto de uma execução deliberada de migrações.

Os limites iniciais foram aplicados com base nos picos observados e estão na tabela a seguir; a coleta prolongada deve confirmar sua adequação ao uso real. Não inferir que o limite de 128 MiB do coletor serve para qualquer aplicação. Critérios: HTTP e recarga preservados, sem OOM, folga de RAM no host e ausência de crescimento contínuo de swap/memória ao longo de 24–48 horas. Não faça `swapoff` no host pressionado para produzir uma fotografia artificialmente limpa.

## Limites aplicados e estado operacional

| Serviço | Teto RAM | Teto adicional de swap |
|---|---:|---:|
| Orbit Dev (API e web juntos) | 2500 MiB | 1000 MiB |
| Suinda web/API, cada | 2 GiB | 1 GiB |
| Safdoulas V2 web/API, cada | 2 GiB | 1 GiB |
| Cada PostgreSQL | 1 GiB | 512 MiB |
| API de produção | 2 GiB | 1 GiB |
| Web de produção / controle, cada | 512 MiB | 256 MiB |
| ClamAV | 3 GiB | 2 GiB |
| Adope web | 1536 MiB | 512 MiB |
| Adope API | 512 MiB | 256 MiB |

Os tetos são individuais e não são pré-alocados. A soma pode superar a memória física; capacidade depende do uso simultâneo observado. Contadores `memory.events:max` podem indicar recuperação de cache, sem OOM. Avalie `oom`/`oom_kill`, pressão e disponibilidade do host separadamente.

As configurações Compose aplicadas e suas diferenças estão em [runtime/README.md](runtime/README.md). A API Safdoulas já roda com seu observador de desenvolvimento; seu processo foi preservado porque existem quatro migrações de autenticação pendentes de outra frente. A trava de compilação está ativa nos processos reiniciados Dev e Suinda; o suporte no script Safdoulas está preparado para uma próxima atualização coordenada da API. Nenhuma versão nova de migração foi aplicada. Ao reiniciar, a API Suinda executou seu `db:migrate` padrão, incluindo `schema.sql` e `seedDatabase`; essa rotina pode reconciliar registros de inicialização. As demais APIs não executaram essa rotina nesta intervenção.

Nos builds de validação, passe `ORBIT_NEXT_DIST_DIR=.next-validation` além da trava. Isso evita que variáveis herdadas de uma API executora direcionem `next build` para o diretório usado por um frontend de desenvolvimento. Exemplo no host:

```sh
ORBIT_NEXT_DIST_DIR=.next-validation flock --exclusive /home/meada/projetos/orbit/control/state/dev-locks/build.lock npm run build
```

Depois dos testes, remova dos includes do TypeScript somente entradas temporárias geradas pela validação. Preserve os caminhos do diretório real do servidor dev. Não atualize dependências de um volume compartilhado enquanto processos consumidores estiverem usando-o; mantenha versões coerentes com o lockfile e recarregue o frontend de forma coordenada.

## Prazo do coletor e leitura da observação

A partir de 09/11/2026 o prazo usa `CLOCK_BOOTTIME`, incluindo a suspensão do Linux. A cadência das amostras continua usando o relógio monotônico; o computador suspenso não produz amostras. A coleta anterior, arquivada em `samples-before-20261109.jsonl`, abrangia cerca de 4h40 de relógio acordado, distribuídas por vários dias. Ela não comprova 48 horas de uso contínuo.

O serviço instalado usa o código deste diretório e gera automaticamente `observation-followup.json` e `.md` quando termina. Para atualizar o resumo durante a execução:

```sh
python3 tools/dev-runtime/observation-summary.py --input /home/meada/projetos/orbit/control/state/ram-20261101/samples.jsonl --output-prefix /home/meada/projetos/orbit/control/state/ram-20261101/observation-followup
```

O resumo processa JSONL em fluxo, distingue lacunas de tempo acordado e apresenta contadores por identidade observada. Os números amostrados podem perder picos entre leituras; use a pressão de memória e os eventos de OOM para complementar a análise.
