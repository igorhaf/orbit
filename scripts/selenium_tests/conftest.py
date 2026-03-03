"""
ORBIT Selenium Tests - Shared Fixtures
========================================
Session-scoped fixtures for headless Chrome, API access, and Ollama chain setup.
"""

import os
import time
import json
import pytest
import requests

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

from helpers import take_screenshot


# ---- Constants ----
BASE_URL = "http://localhost:3000"
API_URL = "http://localhost:8000"
OLLAMA_HOST = "http://172.27.144.1:11434"
PROJECT_ID = "2f663753-f159-4391-b152-5d31c9b8f9d6"

# Ollama model mapping per usage_type
OLLAMA_MODEL_MAP = {
    "interview":          {"model_id": "qwen3:8b",          "name": "Ollama Qwen3 8B (Interview)"},
    "prompt_generation":  {"model_id": "qwen3:14b",         "name": "Ollama Qwen3 14B (Prompt)"},
    "task_execution":     {"model_id": "qwen2.5-coder:14b", "name": "Ollama Qwen2.5 Coder 14B (Task)"},
    "commit_generation":  {"model_id": "qwen3:8b",          "name": "Ollama Qwen3 8B (Commit)"},
    "content_generation": {"model_id": "qwen3:14b",         "name": "Ollama Qwen3 14B (Content)"},
    "rag_extraction":     {"model_id": "qwen3:14b",         "name": "Ollama Qwen3 14B (RAG)"},
    "memory":             {"model_id": "qwen3:8b",          "name": "Ollama Qwen3 8B (Memory)"},
    "general":            {"model_id": "qwen3:8b",          "name": "Ollama Qwen3 8B (General)"},
    "pattern_discovery":  {"model_id": "qwen2.5-coder:14b", "name": "Ollama Qwen2.5 Coder 14B (Discovery)"},
    "queue_orchestration":{"model_id": "qwen3:8b",          "name": "Ollama Qwen3 8B (Queue)"},
}


# ---- Fixtures ----

@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api_url():
    return API_URL


@pytest.fixture(scope="session")
def ollama_host():
    return OLLAMA_HOST


@pytest.fixture(scope="session")
def project_id():
    return PROJECT_ID


@pytest.fixture(scope="session")
def driver():
    """Session-scoped headless Chrome driver."""
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1920,1080")
    opts.set_capability("goog:loggingPrefs", {"browser": "ALL"})

    service = Service(ChromeDriverManager().install())
    d = webdriver.Chrome(service=service, options=opts)
    d.implicitly_wait(5)

    yield d

    d.quit()


@pytest.fixture(scope="session", autouse=True)
def setup_ollama_chains(api_url):
    """
    Reconfigure ALL AI Flow chains to use Ollama models.
    Saves original chain config for restoration in teardown.
    """
    original_chains = {}
    created_model_ids = []

    try:
        # 1. Backup current chains
        resp = requests.get(f"{api_url}/api/v1/ai-flow/chains", timeout=10)
        if resp.status_code == 200:
            chains = resp.json()
            for chain in chains:
                original_chains[chain["usage_type"]] = chain["chain"]

        # 2. Get existing Ollama models
        resp = requests.get(f"{api_url}/api/v1/ai-models/", timeout=10)
        existing_models = resp.json() if resp.status_code == 200 else []
        ollama_models = {m["usage_type"]: m for m in existing_models
                        if m["provider"] == "ollama" and m["is_active"]}

        # 3. Create Ollama models for each usage_type that doesn't have one
        usage_type_model_ids = {}

        for usage_type, cfg in OLLAMA_MODEL_MAP.items():
            # Check if we already have an ollama model for this exact usage_type
            existing = None
            for m in existing_models:
                if (m["provider"] == "ollama" and m["usage_type"] == usage_type
                        and m["is_active"] and m.get("config", {}).get("model_id") == cfg["model_id"]):
                    existing = m
                    break

            if existing:
                usage_type_model_ids[usage_type] = existing["id"]
                continue

            # Create new Ollama model for this usage_type
            model_data = {
                "name": cfg["name"],
                "provider": "ollama",
                "api_key": "not-needed-for-local",
                "usage_type": usage_type,
                "is_active": True,
                "config": {
                    "model_id": cfg["model_id"],
                    "max_tokens": 8192,
                    "temperature": 0.6,
                    "top_p": 0.9,
                    "top_k": 40,
                    "context_length": 32768,
                    "keep_alive": "15m",
                },
                "timeout_seconds": 600,
                "max_concurrent_requests": 1,
            }

            try:
                resp = requests.post(
                    f"{api_url}/api/v1/ai-models/",
                    json=model_data,
                    headers={"Content-Type": "application/json"},
                    timeout=15,
                )
                if resp.status_code in (200, 201):
                    new_model = resp.json()
                    usage_type_model_ids[usage_type] = new_model["id"]
                    created_model_ids.append(new_model["id"])
                else:
                    # If name conflicts, try finding existing by name
                    for m in existing_models:
                        if m["name"] == cfg["name"]:
                            usage_type_model_ids[usage_type] = m["id"]
                            break
            except Exception as e:
                print(f"  WARN: Failed to create model for {usage_type}: {e}")

        # 4. Update all chains to point to Ollama models
        for usage_type, model_id in usage_type_model_ids.items():
            try:
                chain_data = {
                    "usage_type": usage_type,
                    "chain": [model_id],
                    "is_active": True,
                }
                resp = requests.put(
                    f"{api_url}/api/v1/ai-flow/chains/{usage_type}",
                    json=chain_data,
                    headers={"Content-Type": "application/json"},
                    timeout=10,
                )
            except Exception as e:
                print(f"  WARN: Failed to update chain for {usage_type}: {e}")

    except Exception as e:
        print(f"  ERROR in setup_ollama_chains: {e}")

    yield {
        "original_chains": original_chains,
        "created_model_ids": created_model_ids,
        "usage_type_model_ids": usage_type_model_ids,
    }

    # Teardown: Restore original chains
    for usage_type, chain in original_chains.items():
        try:
            requests.put(
                f"{api_url}/api/v1/ai-flow/chains/{usage_type}",
                json={"usage_type": usage_type, "chain": chain, "is_active": True},
                headers={"Content-Type": "application/json"},
                timeout=10,
            )
        except Exception:
            pass

    # Clean up created models
    for model_id in created_model_ids:
        try:
            requests.delete(f"{api_url}/api/v1/ai-models/{model_id}", timeout=10)
        except Exception:
            pass


@pytest.fixture(autouse=True)
def screenshot_on_failure(request, driver):
    """Capture screenshot on test failure."""
    yield
    if request.node.rep_call and request.node.rep_call.failed:
        test_name = request.node.name.replace(" ", "_").replace("/", "_")
        take_screenshot(driver, f"FAIL_{test_name}")


@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """Attach test result to item for screenshot_on_failure fixture."""
    import pluggy
    outcome = yield
    rep = outcome.get_result()
    setattr(item, f"rep_{rep.when}", rep)
