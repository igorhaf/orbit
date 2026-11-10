# Suindá

Suindá é a plataforma de cursos construída sobre Orbit. Esta pasta contém sua execução isolada; o código fica em `app/`, dentro do monorepo Orbit e da branch única `main`.

## Mapa

| Caminho | Conteúdo |
| --- | --- |
| `app/` | Aplicação Orbit/Suindá e repositório Git dedicado |
| `compose.yml`, `Dockerfile`, `docker-entrypoint.sh` | Definição dos serviços Suindá |
| `data/config/` | Configuração local privada da API |
| `data/db-init/` | Inicialização local do banco |
| `data/backups/` | Backups locais do produto |
| `data/sessions/` | Estado local de sessões de execução |

Não mova `app/` para dentro de outro repositório nem misture seus dados ou volumes com DEV/PROD. Core Orbit reutilizável deve continuar compatível com os demais checkouts; funcionalidades de domínio acadêmico ficam em plugins filhos do Suindá.

## Endereços locais

| Serviço | Endereço |
| --- | --- |
| Interface no shell Orbit escuro | <http://localhost:3003/suinda> |
| API / health | <http://localhost:4004/health> |
| PostgreSQL dedicado | `127.0.0.1:5434` |

Na consulta de 10/11/2026, Web e API responderam HTTP 200. O utilitário Docker não estava disponível nesta sessão, então o estado dos containers não foi verificado.

## Estado do produto

A matriz reconciliada em `app/docs/suinda/REQUISITOS.md` e `app/SUINDA.md` registra 403 requisitos: 360 implementados, 2 parciais e 41 associados a configuração ou validação externa; essa classificação é inventário de implementação, não prova de homologação. O usuário pediu que o trabalho prossiga usando dados sintéticos enquanto as dependências externas ficam de fora.

O runner documentado em [`app/docs/suinda/INTEGRACOES-DEMO.md`](app/docs/suinda/INTEGRACOES-DEMO.md) mapeia 41 IDs e sua última execução registrada passou em 487/487 testes. Isso valida contratos com fixtures; não instala cursos demonstrativos no banco nem substitui configuração/prova de provedores. OIDC completo e DNS/TLS público ainda estavam fora da simulação documentada; `31.9` e `32.15` continuam parciais por motivos distintos.

## Documentação fonte

- [Visão geral, decisões recentes e histórico do Suindá](app/SUINDA.md)
- [Arquitetura e decisões de plugins](app/docs/suinda/ARQUITETURA.md)
- [Requisitos reconciliados](app/docs/suinda/REQUISITOS.md)
- [Auditoria por requisito](app/docs/suinda/AUDITORIA-BULLETS-2026-10-25.md)
- [Cenários com dados sintéticos e limites](app/docs/suinda/INTEGRACOES-DEMO.md)
- [Acessibilidade e evidências](app/docs/suinda/VALIDACAO-ACESSIBILIDADE.md)
- [Pré-requisitos externos restantes](app/docs/suinda/PRE-REQUISITOS-EXTERNOS.md)

## Operação

Para inspeção sem alterar serviços:

```sh
docker compose -f compose.yml config --quiet
docker compose -f compose.yml ps
```

Os comandos rodam nesta pasta. Não use o Compose da raiz Orbit para administrar Suindá, nem `docker compose down` na pilha agregada. Para código, acesse `app/` e leia [`../AGENTS.md`](../AGENTS.md) e quaisquer instruções locais antes de editar. O seed genérico da API cria/atualiza uma conta ROOT Orbit e não é um seed de demonstração do Suindá.
