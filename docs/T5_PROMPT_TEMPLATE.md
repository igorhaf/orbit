# T5 — Template Canônico de Prompt/Contract do Orbit

> Fonte de verdade do padrão estruturado de prompts. Todo contract de geração
> (`backend/app/contracts/*.py`) DEVE seguir esta estrutura, na ORDEM fixa das
> seções, para que entrada e saída sejam previsíveis e validáveis — sem fugir do
> formato. Gerado a partir da auditoria de 2026-06-14. Referência de ouro
> existente: `PIPELINE_CARD_SEMANTIC_PROMPT_SYSTEM` (`pipeline_contracts.py:63`).

---

## Por que T5 existe (o problema que resolve)

Hoje os prompts do Orbit divergem: coexistem ~5 "formatos" sem esqueleto comum,
o contrato de SAÍDA aparece só como prosa (`"RESPONDA APENAS COM JSON"`) e
**nunca é validado** — sobra `extract_json(...) or {}` como rede, que é a raiz do
fail-silent (CLAUDE.md §1A). Medição da auditoria: a seção **MÉTODO / COMO
REPRODUZIR tem 0 ocorrências** em todos os prompts — é a peça sistematicamente
ausente. O T5 fixa um esqueleto único, com contrato de entrada e de saída
explícitos, para que:

1. a mesma entrada produza sempre a mesma ESTRUTURA de saída;
2. a saída seja validável por schema (parar de engolir erro com `or {}`);
3. qualquer autor (humano ou IA) escreva prompts consistentes.

---

## Perfis

Nem todo contract precisa de todas as seções. Há 3 perfis:

| Perfil | Quem | Seções obrigatórias |
|--------|------|---------------------|
| **GERACAO** | pipeline, generation, wiki, cards — produzem JSON/markdown estruturado | 1–9 (todas) |
| **CONVERSA** | interviews — USER é injetado em runtime, saída é diálogo | 1–6, 9 (sem CONTRATO DE SAÍDA rígido) |
| **DADOS** | business/execution/validation — data-only, sem persona | 1, 2, 4, 7, 9 |

---

## Estrutura (ordem OBRIGATÓRIA e fixa)

Cabeçalhos de seção **sem acento** (para grep determinístico do linter). O
conteúdo pode (e deve) ter acentos.

```markdown
# T5: <nome_do_contrato>

## 1. IDENTIDADE                                      [obrigatorio]
dominio: pipeline | generation | interviews | business | memory | execution | validation
modulo: <subsistema/fase, ex: deep_pipeline.phase4a_epics>
perfil: GERACAO | CONVERSA | DADOS
versao: <int>
status: active | draft | deprecated
usage_type: <chave do orchestrator, ex: rag_extraction>

## 2. CONTEXTO                                        [obrigatorio]
Onde este prompt roda no fluxo: fase anterior -> esta fase -> proxima fase.
O que recebe, por que existe. 2-5 frases. (Liga ao trace_id da run.)

## 3. PAPEL / PERSONA                                 [obrigatorio: GERACAO, CONVERSA]
"Voce e um <papel senior>. NAO tem acesso a ferramentas. Analise APENAS os
dados fornecidos."

## 4. CONTRATO DE ENTRADA                             [obrigatorio]
variaveis_obrigatorias:
  - nome: <var>   tipo: string|number|object|array   descricao: <...>
variaveis_opcionais:
  - nome: <var>   tipo: <...>   default: <...>   descricao: <...>
# O loader DEVE validar presenca das obrigatorias antes de renderizar.

## 5. METODO / COMO REPRODUZIR                        [obrigatorio]  <-- HOJE AUSENTE
Passos numerados e DETERMINISTICOS que o modelo segue para produzir a saida:
  1. <extraia X de {{var}}>
  2. <agrupe por dominio / ordene por ...>
  3. <para cada grupo, gere ...>
Objetivo: mesma entrada -> mesma estrutura de saida, sempre.

## 6. O QUE NAO FAZER                                 [obrigatorio]
Lista negativa explicita:
  - NAO inventar dados que nao estao na entrada.
  - NAO usar termos tecnicos crus (quando o publico e de negocio).
  - NAO retornar markdown nem ```json (apenas o JSON/conteudo puro).
  - NAO responder em ingles (saida em portugues).
  - NAO encolher / resumir abaixo do minimo (anti-shrink).

## 7. CONTRATO DE SAIDA                               [obrigatorio: GERACAO]  <-- VALIDADO, nao prosa
formato: json | markdown | text
output_schema:        # JSON Schema REAL — usado pelo validador pos-resposta
  type: object
  required: [<campos>]
  properties:
    <campo>: { type: <...>, ... }
exemplo_minimo:
  { ... }            # 1 exemplo valido minimo

## 8. CRITERIOS DE QUALIDADE                          [obrigatorio: GERACAO]
Viram checks blocking/warning pos-resposta. Reusar o vocabulario de
PIPELINE_VALIDATION_RULES (pipeline_contracts.py):
  - { check: min_length,        valor: 800,  severity: warning }
  - { check: mandatory_sections, valor: [...], severity: blocking }
  - { check: no_technical_terms, severity: warning }
  - { check: anti_shrink,        severity: blocking }

## 9. GOVERNANCA                                      [obrigatorio]
owner: <time/pessoa>
effective_date: <YYYY-MM-DD>
change_log:
  - <YYYY-MM-DD>: <mudanca>

## 10. ENTREGA / EXECUCAO                             [opcional]
recommended_model: claude-sonnet-4-6 | claude-haiku-4-5 | claude-opus-4-7
max_tokens: <int>
thinking_budget: <int|null>
```

---

## Regras de aderência (o que o linter T5 verifica)

O linter (`backend/scripts/lint_t5.py`) roda em CI e falha o build se:

1. **Seções obrigatórias presentes** conforme o perfil (1,2,4,5,6,9 sempre;
   3 em GERACAO/CONVERSA; 7,8 em GERACAO).
2. **Ordem das seções** é a fixa acima (1→10).
3. **Cabeçalhos sem acento** (grep determinístico).
4. **`7.output_schema` é JSON Schema parseável.** Em GERACAO, o pipeline DEVE
   validar a resposta do modelo contra esse schema após `extract_json` e, em
   falha: `logger.error(preview)` + discriminar cota/corrupção + `raise`.
   **NUNCA `extract_json(...) or {}`** (anti-pattern #1 do CLAUDE.md §1A).
5. **Seção 8 mapeia 1:1** para checks pós-resposta (reusar
   `ai_flow/executors_pure.py:195` — `json_schema_validator`).

---

## Contrato de SAÍDA validado — o ponto central

A diferença prática do T5: o `output_schema` (seção 7) deixa de ser prosa e vira
um **JSON Schema executável**. Fluxo correto pós-resposta (substitui o
`or {}`):

```python
raw = result.get("text", "") or ""
parsed = self.claudius.extract_json(raw)
if not parsed or not _validate_against(parsed, contract.output_schema):
    from app.services.claudius_pipeline import _QUOTA_PATTERNS
    if raw and len(raw) < 500 and _QUOTA_PATTERNS.search(raw):
        raise ClaudiusQuotaExhaustedError(...)
    logger.error("contract X: saida invalida (stop=%r, len=%d): %r",
                 result.get("stop_reason"), len(raw), raw[:200])
    raise ClaudiusPipelineError("contract X: saida nao conforme ao output_schema")
```

A infra de validação **já existe** mas está desacoplada: o modelo `Validator`
(`contracts/models.py`), o `pipeline_validator.py` e o `PIPELINE_VALIDATION_RULES`
(`pipeline_contracts.py:1025`) são hoje código morto. Religá-los é a tarefa de
migração — NÃO reescrever do zero.

---

## Ordem de migração (maior ROI primeiro)

A migração dos contracts existentes para T5 é gradual. Comece pelos de maior
impacto e parsing mais frágil:

1. **`deep_file_analysis`** (Phase 1) — 256 chamadas/run, alto volume, JSON.
2. **`deep_architectural_map` + `deep_epic_generation`** — junções críticas; o
   `output_schema` corta o `AttributeError` da Phase 4a (CLAUDE.md #3) na raiz.
3. **`wiki_domain` + `wiki_overview`** — já têm "CONTRATO JSON RIGIDO" em prosa;
   falta só o schema executável + ligar `PIPELINE_VALIDATION_RULES.wiki_page`.
4. **`cards_epic` + `cards_detail`** — fechar os user-prompts vazios (artefatos
   de refatoração montados em runtime).
5. **Referência de ouro a copiar:** `pipeline/card_semantic_prompt`
   (`pipeline_contracts.py:63`) — já é T5 em quase tudo, menos a seção MÉTODO.

**Adiar:** business/execution/validation (DADOS) e interviews (CONVERSA) — menor
risco de parsing e menor volume.

---

## Como NÃO migrar (armadilhas)

- **Não ligar retry-loop antes de medir a taxa de rejeição** do `output_schema`
  por 2–3 semanas (CLAUDE.md §5 — retry antes de medir é otimização prematura,
  pode triplicar latência pra resolver problema de <1%).
- **Não preencher user-prompts vazios com Jinja2** se eles são montados em
  runtime — marcar `# montado em runtime` em vez de inventar template.
- **Não diminuir o count de domínios** nem nada que os contracts validam contra
  (regra crítica da MEMORY.md).
