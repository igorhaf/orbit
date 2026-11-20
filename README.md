# Orbit · ambientes e projetos

Esta é a raiz do monorepo Orbit e da instalação local. Os ambientes e produtos permanecem em diretórios próprios para preservar seus Docker Compose e isolamento de execução. O código está na branch única `main`; o snapshot inicial está marcado por `orbit-monorepo-baseline-2026-11-10`.

## Mapa dos ambientes

| Ambiente/produto | Código-fonte | Branch | Web / API | Uso |
| --- | --- | --- | --- | --- |
| Orbit DEV | [`forge/app`](forge/app/) | `main` | `3001` / `4001` | Desenvolvimento do Orbit |
| Orbit PROD | [`workspace/app`](workspace/app/) | `main` | `3000` / `4000` | Produção do Orbit |
| Safdoulas | [`safdoulas/app`](safdoulas/app/) | `main` | `3002` / `4003` | Validação do produto Safdoulas |
| Suindá | [`suinda/app`](suinda/app/) | `main` | `3003` / `4004` | Plataforma de cursos sobre Orbit |
| CONTROL | [`control`](control/) | ferramentas operacionais | sem interface pública | Administração explícita dos ambientes |

Cada ambiente possui configuração, banco e volumes próprios. As fontes comuns registradas em `orbit.workspace.json` ficam em `packages/` e são projetadas nas aplicações com versão e hash. Outros módulos ainda têm variantes locais e exigem revisão de integração entre os ambientes.

## Por onde começar

- [Desenvolvimento acelerado: pacotes, geradores, catálogo, contexto, verificações e entregas](docs/acceleration/README.md)
- [Arquitetura da instalação, isolamento, portas e operação](README-ARCHITECTURE.md)
- [Ambiente Suindá, Compose e documentação específica](suinda/README.md)
- [Decisões de domínio e plugins do Suindá](suinda/app/docs/suinda/ARQUITETURA.md)
- [Requisitos e estado reconciliado do Suindá](suinda/app/docs/suinda/REQUISITOS.md)
- [Checklist de cenários sintéticos e limites de homologação](suinda/app/docs/suinda/INTEGRACOES-DEMO.md)
- [Comandos operacionais CONTROL](control/bin/orbit-env)

## Regras de trabalho

- Abra esta raiz como projeto principal: o repositório e a branch `main` abrangem código, Compose, CONTROL e documentação.
- Use os caminhos de cada produto para respeitar diferenças de código e execução. Suindá permanece em `suinda/app`, com dados, Compose e serviços isolados.
- Não copie segredos ou dados de negócio entre ambientes. Os arquivos locais de configuração e os dados persistidos são específicos de cada ambiente.
- Leia [`AGENTS.md`](AGENTS.md) antes de desenvolver. Delegação não amplia escopo nem autoriza commit ou deploy.

