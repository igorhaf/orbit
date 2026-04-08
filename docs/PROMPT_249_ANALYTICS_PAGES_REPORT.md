# PROMPT #249 - Split Dashboard into Tokens & Costs Analytics Pages

## Objective
Replace the single "Painel" dashboard page with two dedicated analytics pages: "Tokens & Desempenho" for token consumption and performance metrics, and "Custos Financeiros" for financial cost tracking and projections.

## What Was Implemented

### New Pages
1. **Tokens & Desempenho** (`/analytics/tokens`) — Token consumption, execution performance, cache effectiveness, and RAG metrics
2. **Custos Financeiros** (`/analytics/costs`) — Financial cost tracking, cost breakdowns, daily trends, recent executions, savings summary

### Tokens Page Features
- 4 summary cards: Tokens Totais, Total de Execuções, Tempo Médio de Execução, Taxa de Acerto do Cache
- Token consumption by provider table with proportional CSS bars
- Token consumption by usage type table with average tokens/call
- Full cache performance section (L1/L2/L3) with auto-refresh every 30s
- RAG metrics section with hit rate, similarity, retrieval time, and per-usage-type breakdown
- Executions by provider horizontal bar chart (CSS-based)

### Costs Page Features
- 4 summary cards: Custo Total, Custo Médio/Execução, Economia do Cache, Projeção Mensal
- Cost by provider and usage type tables (side by side)
- Daily cost trend CSS bar chart
- Paginated recent executions table with cost per execution
- Savings summary comparing real cost vs hypothetical cost without cache

### Navigation Changes
- Navbar: replaced "Painel" with "Tokens" and "Custos" links
- Breadcrumbs: added analytics/tokens/costs labels
- Old `/dashboard` URL redirects to `/analytics/tokens`

## Files Created
- `frontend/src/lib/api/analytics.ts` — Typed API client for all analytics endpoints
- `frontend/src/app/analytics/tokens/page.tsx` — Tokens & Performance page
- `frontend/src/app/analytics/costs/page.tsx` — Financial Costs page

## Files Modified
- `frontend/src/lib/api/index.ts` — Export analyticsApi
- `frontend/src/components/layout/Navbar.tsx` — Replace Painel with Tokens/Custos
- `frontend/src/components/layout/Breadcrumbs.tsx` — Add analytics route labels
- `frontend/src/app/dashboard/page.tsx` — Redirect to /analytics/tokens

## Backend Changes
None — all data comes from existing endpoints:
- `GET /api/v1/cost/analytics`
- `GET /api/v1/cache/stats`
- `GET /api/v1/ai-executions/stats`
- `GET /api/v1/cost/rag-stats`
- `GET /api/v1/cost/executions-with-cost`

## Testing Results
- Frontend build: SUCCESS (no errors)
- All existing API endpoints already tested and working

## Status
COMPLETED
