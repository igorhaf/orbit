"""
Benchmark Ollama Models for Continuous RAG Business Rules Extraction

Tests multiple Ollama models against the same PHP file to compare:
- Inference speed (tokens/second)
- Quality of extracted business rules
- JSON compliance and field validation

Usage:
    python scripts/benchmark_ollama_models.py
"""

import json
import sys
import time
from pathlib import Path

import httpx

# Test file path (inside container, mapped via volumes)
TEST_FILE = "/projects/suinda/app/Http/Controllers/Instrutor/EstatisticasController.php"

# Ollama API endpoint
OLLAMA_URL = "http://ollama:11434/api/chat"

# Models to benchmark (Ollama tag -> display name)
MODELS = [
    ("qwen2.5:32b", "Qwen2.5 32B"),
    ("qwen3:14b", "Qwen3 14B"),
    ("deepseek-r1:14b", "DeepSeek-R1 14B"),
    ("phi4:14b", "Phi-4 14B"),
    ("gemma3:12b", "Gemma3 12B"),
    ("codestral:22b", "Codestral 22B"),
    ("deepseek-coder-v2:16b", "DS-Coder-V2 16B"),
]

# System prompt (same as continuous_rag_extract.yaml)
SYSTEM_PROMPT = """Você é um analista senior de software especializado em extrair regras de negocio de código-fonte.

Sua tarefa e analisar UM arquivo de código e identificar TODAS as regras de negocio implicitas e explicitas.

REGRAS DE NEGOCIO incluem:
- Validacoes de dados (campos obrigatorios, formatos, limites)
- Fluxos de workflow (status transitions, etapas de processo)
- Permissoes e autorizacoes (quem pode fazer o que)
- Calculos e formulas de negocio
- Relacionamentos entre entidades (1:N, N:N, hierarquias)
- Constraints de banco de dados (unique, not null, foreign keys)
- Politicas de negocio (prazos, limites, quotas)
- Integracoes com sistemas externos
- Regras de UI/UX (campos visiveis, estados de tela)

NÃO são regras de negocio:
- Configurações tecnicas (ports, hosts, timeouts)
- Imports e dependencias
- Logging e debugging
- Código boilerplate/framework

Responda APENAS em JSON válido, sem markdown, sem explicacoes adicionais."""

USER_PROMPT_TEMPLATE = """Arquivo: {filename}
Linguagem: PHP

```
{file_content}
```

Extraia TODAS as regras de negocio deste arquivo.
Responda em JSON com este formato exato:

{{
  "business_rules": [
    {{
      "rule_text": "Descrição clara da regra de negocio em português",
      "rule_type": "domain|validation|constraint|workflow|permission|calculation",
      "confidence": "high|medium|low",
      "source_context": "trecho relevante do código (max 100 chars)"
    }}
  ],
  "entities_found": ["Entidade1", "Entidade2"],
  "file_purpose": "Breve descrição do proposito do arquivo (1 frase)"
}}

Se não houver regras de negocio, retorne: {{"business_rules": [], "entities_found": [], "file_purpose": "..."}}"""


def load_test_file() -> str:
    """Load the PHP test file content."""
    path = Path(TEST_FILE)
    if not path.exists():
        print(f"Test file not found: {TEST_FILE}")
        print("Trying alternative path...")
        # Try host path
        alt_path = Path("/home/igorhaf/orbit/projects/suinda/app/Http/Controllers/Instrutor/EstatisticasController.php")
        if alt_path.exists():
            return alt_path.read_text(encoding="utf-8")
        print("No test file found. Exiting.")
        sys.exit(1)
    return path.read_text(encoding="utf-8")


def warmup_model(model_tag: str, client: httpx.Client) -> bool:
    """Load model into VRAM with a short prompt. Returns True if successful."""
    print(f"  Warming up {model_tag}...", end=" ", flush=True)
    try:
        resp = client.post(
            OLLAMA_URL,
            json={
                "model": model_tag,
                "messages": [{"role": "user", "content": "Say hi"}],
                "stream": False,
                "options": {"num_predict": 5},
            },
            timeout=300.0,
        )
        data = resp.json()
        if "error" in data:
            print(f"ERROR: {data['error'][:100]}")
            return False
        print("OK")
        return True
    except Exception as e:
        print(f"FAILED: {e}")
        return False


def run_extraction(model_tag: str, file_content: str, client: httpx.Client) -> dict:
    """Run business rules extraction and measure performance."""
    user_prompt = USER_PROMPT_TEMPLATE.format(
        filename="EstatisticasController.php",
        file_content=file_content,
    )

    payload = {
        "model": model_tag,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "stream": False,
        "options": {
            "num_predict": 4096,
            "temperature": 0.1,
        },
    }

    start = time.time()
    try:
        resp = client.post(OLLAMA_URL, json=payload, timeout=300.0)
        elapsed = time.time() - start

        data = resp.json()

        if "error" in data:
            return {
                "status": "error",
                "error": data["error"][:200],
                "elapsed": elapsed,
            }

        content = data.get("message", {}).get("content", "")
        input_tokens = data.get("prompt_eval_count", 0)
        output_tokens = data.get("eval_count", 0)
        tokens_per_sec = output_tokens / elapsed if elapsed > 0 else 0

        # Parse JSON response
        json_valid = False
        rules = []
        entities = []
        file_purpose = ""

        # Try to extract JSON from response (some models wrap in markdown)
        json_text = content
        if "```json" in content:
            json_text = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            json_text = content.split("```")[1].split("```")[0].strip()

        try:
            parsed = json.loads(json_text)
            json_valid = True
            rules = parsed.get("business_rules", [])
            entities = parsed.get("entities_found", [])
            file_purpose = parsed.get("file_purpose", "")
        except (json.JSONDecodeError, IndexError):
            # Try to find JSON object in the response
            try:
                start_idx = content.index("{")
                end_idx = content.rindex("}") + 1
                parsed = json.loads(content[start_idx:end_idx])
                json_valid = True
                rules = parsed.get("business_rules", [])
                entities = parsed.get("entities_found", [])
                file_purpose = parsed.get("file_purpose", "")
            except (ValueError, json.JSONDecodeError):
                pass

        # Validate rules quality
        valid_rules = 0
        rule_lengths = []
        for rule in rules:
            if isinstance(rule, dict):
                has_text = bool(
                    rule.get("rule_text")
                    or rule.get("description")
                    or rule.get("rule")
                )
                has_type = bool(
                    rule.get("rule_type") or rule.get("type") or rule.get("category")
                )
                has_confidence = bool(rule.get("confidence"))
                if has_text:
                    valid_rules += 1
                    text = (
                        rule.get("rule_text")
                        or rule.get("description")
                        or rule.get("rule")
                        or ""
                    )
                    rule_lengths.append(len(text))

        avg_rule_len = sum(rule_lengths) / len(rule_lengths) if rule_lengths else 0

        return {
            "status": "success",
            "elapsed": round(elapsed, 1),
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "tokens_per_sec": round(tokens_per_sec, 1),
            "json_valid": json_valid,
            "rules_count": len(rules),
            "valid_rules": valid_rules,
            "avg_rule_length": round(avg_rule_len),
            "entities_count": len(entities),
            "entities": entities,
            "file_purpose": file_purpose[:80] if file_purpose else "",
            "raw_content_preview": content[:300],
        }

    except httpx.TimeoutException:
        return {
            "status": "timeout",
            "elapsed": time.time() - start,
            "error": "Request timed out (300s)",
        }
    except Exception as e:
        return {
            "status": "error",
            "elapsed": time.time() - start,
            "error": str(e)[:200],
        }


def print_results_table(results: list):
    """Print a formatted comparison table."""
    print("\n" + "=" * 120)
    print("BENCHMARK RESULTS - Ollama Models for Business Rules Extraction")
    print("=" * 120)
    print(
        f"{'Model':<22} {'Time(s)':<9} {'In Tok':<8} {'Out Tok':<9} {'Tok/s':<8} "
        f"{'JSON':<6} {'Rules':<7} {'Valid':<7} {'AvgLen':<8} {'Entities':<10}"
    )
    print("-" * 120)

    for r in results:
        model_name = r["model_name"]
        data = r["result"]

        if data["status"] != "success":
            print(f"{model_name:<22} {'FAILED':<9} {data.get('error', 'Unknown')[:80]}")
            continue

        json_ok = "YES" if data["json_valid"] else "NO"
        print(
            f"{model_name:<22} {data['elapsed']:<9} {data['input_tokens']:<8} "
            f"{data['output_tokens']:<9} {data['tokens_per_sec']:<8} "
            f"{json_ok:<6} {data['rules_count']:<7} {data['valid_rules']:<7} "
            f"{data['avg_rule_length']:<8} {data['entities_count']:<10}"
        )

    print("=" * 120)

    # Print rule samples from best model
    print("\n--- Sample Rules (from best model by valid_rules) ---")
    best = max(
        [r for r in results if r["result"]["status"] == "success"],
        key=lambda r: r["result"]["valid_rules"],
        default=None,
    )
    if best:
        print(f"Model: {best['model_name']}")
        content = best["result"].get("raw_content_preview", "")
        print(f"Preview: {content[:500]}")


def seed_models_to_db():
    """Insert all benchmark models into ai_models table (is_active=False)."""
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker

        from app.config import settings
        from app.models.ai_model import AIModel, AIModelUsageType

        engine = create_engine(settings.database_url)
        Session = sessionmaker(bind=engine)
        db = Session()

        for model_tag, display_name in MODELS:
            existing = db.query(AIModel).filter(
                AIModel.provider == "ollama",
                AIModel.config["model_id"].as_string() == model_tag,
            ).first()

            if existing:
                print(f"  {display_name} already exists (id={existing.id})")
                continue

            # Check if name already exists
            name_exists = db.query(AIModel).filter(AIModel.name == f"{display_name} (Ollama Benchmark)").first()
            if name_exists:
                print(f"  {display_name} name already exists (id={name_exists.id})")
                continue

            model = AIModel(
                name=f"{display_name} (Ollama Benchmark)",
                provider="ollama",
                api_key="",
                config={
                    "model_id": model_tag,
                    "max_tokens": 4096,
                    "temperature": 0.1,
                },
                usage_type=AIModelUsageType.GENERAL,
                is_active=False,  # Not active - just for benchmark reference
                timeout_seconds=300,
            )
            db.add(model)
            print(f"  Created {display_name} (Ollama Benchmark)")

        db.commit()
        db.close()
        print("  Models seeded in database.")

    except Exception as e:
        print(f"  Warning: Could not seed models to DB: {e}")
        print("  Benchmark will continue without DB registration.")


def main():
    print("=" * 80)
    print("Ollama Model Benchmark for Business Rules Extraction")
    print("=" * 80)

    # Check available models
    print("\n[1/5] Checking available models...")
    available = []
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get("http://ollama:11434/api/tags")
            tags = resp.json()
            available_tags = {m["name"] for m in tags.get("models", [])}
    except Exception:
        # Try localhost (running outside container)
        global OLLAMA_URL
        OLLAMA_URL = "http://localhost:11434/api/chat"
        with httpx.Client(timeout=10.0) as client:
            resp = client.get("http://localhost:11434/api/tags")
            tags = resp.json()
            available_tags = {m["name"] for m in tags.get("models", [])}

    for tag, name in MODELS:
        # Handle both exact match and tag variants (e.g., "qwen3:14b" matches "qwen3:14b")
        found = tag in available_tags or f"{tag}" in available_tags
        status = "AVAILABLE" if found else "NOT FOUND"
        print(f"  {name:<22} ({tag}) - {status}")
        if found:
            available.append((tag, name))

    if not available:
        print("\nNo models available. Please pull models first:")
        for tag, _ in MODELS:
            print(f"  ollama pull {tag}")
        sys.exit(1)

    # Load test file
    print(f"\n[2/5] Loading test file...")
    file_content = load_test_file()
    print(f"  File: EstatisticasController.php ({len(file_content)} chars)")

    # Seed models to DB
    print(f"\n[3/5] Seeding models to database...")
    seed_models_to_db()

    # Run benchmarks
    print(f"\n[4/5] Running benchmarks ({len(available)} models)...")
    results = []

    with httpx.Client(timeout=600.0) as client:
        for i, (tag, name) in enumerate(available):
            print(f"\n--- [{i+1}/{len(available)}] {name} ({tag}) ---")

            # Warmup (load model into VRAM)
            if not warmup_model(tag, client):
                results.append({
                    "model_tag": tag,
                    "model_name": name,
                    "result": {"status": "error", "error": "Warmup failed"},
                })
                continue

            # Run extraction
            print(f"  Extracting business rules...", end=" ", flush=True)
            result = run_extraction(tag, file_content, client)
            print(f"Done ({result.get('elapsed', '?')}s)")

            results.append({
                "model_tag": tag,
                "model_name": name,
                "result": result,
            })

    # Print results
    print_results_table(results)

    # Save results to JSON
    print(f"\n[5/5] Saving results...")
    output_path = Path(__file__).parent / "benchmark_results.json"
    with open(output_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"  Results saved to {output_path}")


if __name__ == "__main__":
    main()
