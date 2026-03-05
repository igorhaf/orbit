---
title: "Deep Pipeline (7 Fases)"
slug: "deep-pipeline"
source: "generated"
order_index: 8
created_at: "2026-03-05T04:46:25.181976"
updated_at: "2026-03-05T04:46:25.181976"
---

# Deep Pipeline de Análise de Codebase

## 7 Fases

### Phase 0: Structural Scan
- Inventário de todos os arquivos
- Detecção de linguagem (Python, TypeScript, YAML, SQL, etc.)
- Classificação por layer: migration, model, route, service, test, ui, config, infrastructure, prompt_template, schema
- **Sem IA** — análise puramente estrutural

### Phase 1: Per-File Analysis
- **Model:** Claude Haiku (rápido, barato)
- **Concurrency:** 10 workers paralelos
- Extrai: classes, funções, imports, patterns, domínio
- Chunking: 800 chars, 100 overlap

### Phase 2: Cross-File Rule Synthesis
- **Model:** Claude Sonnet (equilibrado)
- **Concurrency:** 5 workers por domínio
- Sintetiza regras de negócio de análises individuais
- Categorias: validation, workflow, calculation, integration

### Phase 3: Architectural Map
- **Model:** Claude Sonnet
- Mapa de domínios com dependências
- Cross-domain flows
- Stored em project.context_semantic

### Phase 4: Card Generation
- **Model:** Claude Opus (alta qualidade)
- Epics por domínio, Stories por feature, Tasks por implementação
- Semantic references, Fibonacci points, dual description
- Dedup via RAG (>0.90)

### Phase 5: Wiki Generation
- **Model:** Claude Opus
- 24+ páginas: overview, domains, architecture, flows, conventions
- YAML front matter + Markdown
- Dual persistence: DB + filesystem

### Phase 6: Quality Assurance
- Score por fase (0-100)
- Formula: completeness (40%) + depth (30%) + consistency (20%) + novelty (10%)
- Threshold: 70

### Phase 7: Gap Filling
- Re-executa fases com score < 70
- Prompts mais detalhados
- Máximo 2 iterações por fase

## Pipeline Profiles
Configuração por fase: modelo, max_tokens, concurrency, quality_threshold. Usuário cria profiles via AI Studio.

