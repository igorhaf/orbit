---
title: "Framework Specs & Token Reduction"
slug: "framework-specs"
source: "generated"
order_index: 14
created_at: "2026-03-05T04:46:25.590343"
updated_at: "2026-03-05T04:46:25.590343"
---

# Framework Specs & Token Reduction

## Conceito

Em vez de incluir instruções verbose sobre frameworks nos prompts, o ORBIT usa especificações concisas armazenadas no banco.

## Dados
- **47 specs** seeded no banco (tabela `framework_specs`)
- Cobrem: Laravel, Next.js, React, Vue, Angular, PostgreSQL, MySQL, Tailwind, Bootstrap, Docker, etc.

## Fluxo

1. Projeto configurado com stack (ex: fastapi, nextjs, postgresql, tailwind)
2. SpecService carrega specs matching o stack
3. Specs injetadas em prompts de backlog generation
4. AI recebe specs concisas em vez de instruções longas

## Economia de Tokens

| Fase | Redução | Mecanismo |
|------|---------|-----------|
| Prompt Generation | 60-80% | Specs substituem instruções verbose |
| Task Execution | 15-20% | Specs seletivas por task type |
| **Total** | **70-85%** | Acumulado |

## Cache
- Specs cacheadas em Redis per-project
- TTL: 1 hora
- Invalidação: quando stack do projeto muda

