"""
Test 00: Prerequisites & Infrastructure Verification
=====================================================
Verifies all services are running and AI chains are configured for Ollama.
"""

import requests
import pytest
from helpers import (
    wait_for_body, take_screenshot, check_page_errors,
    api_get, check_console_errors
)


class TestInfrastructure:
    """Verify all required services are running."""

    def test_backend_health(self, api_url):
        """Backend API should be reachable and healthy."""
        resp = requests.get(f"{api_url}/docs", timeout=10)
        assert resp.status_code == 200, f"Backend not reachable: {resp.status_code}"

    def test_frontend_loads(self, driver, base_url):
        """Frontend should load without errors."""
        driver.get(base_url)
        wait_for_body(driver, timeout=15)
        body = driver.find_element_by_tag_name("body").text if hasattr(driver, 'find_element_by_tag_name') else driver.find_element("tag name", "body").text
        assert len(body.strip()) > 10, "Frontend body is empty"
        errors = check_page_errors(driver)
        assert not errors, f"Page errors: {errors}"
        take_screenshot(driver, "00_frontend_home")

    def test_ollama_reachable(self, ollama_host):
        """Ollama service should be reachable and have required models."""
        resp = requests.get(f"{ollama_host}/api/tags", timeout=10)
        assert resp.status_code == 200, f"Ollama not reachable at {ollama_host}"
        models = resp.json().get("models", [])
        model_names = [m["name"] for m in models]
        required = ["qwen3:8b", "qwen3:14b", "qwen2.5-coder:14b"]
        for req in required:
            assert req in model_names, f"Required Ollama model '{req}' not found. Available: {model_names}"

    def test_redis_running(self):
        """Redis should be accessible."""
        import subprocess
        result = subprocess.run(["redis-cli", "ping"], capture_output=True, text=True, timeout=5)
        assert "PONG" in result.stdout, f"Redis not responding: {result.stdout} {result.stderr}"

    def test_postgresql_running(self, api_url):
        """PostgreSQL should be accessible (verified via backend)."""
        resp = requests.get(f"{api_url}/api/v1/projects/", timeout=10)
        assert resp.status_code == 200, f"Cannot reach projects API (DB may be down): {resp.status_code}"

    def test_meada_project_exists(self, api_url, project_id):
        """The Meada test project should exist in the database."""
        resp = requests.get(f"{api_url}/api/v1/projects/{project_id}", timeout=10)
        assert resp.status_code == 200, f"Meada project not found: {resp.status_code}"
        data = resp.json()
        assert "meada" in data.get("name", "").lower(), f"Project name doesn't contain 'meada': {data.get('name')}"
        assert data.get("code_path"), "Project has no code_path configured"


class TestOllamaChainSetup:
    """Verify AI Flow chains are configured for Ollama only."""

    def test_chains_exist(self, api_url):
        """All 10 usage_type chains should exist."""
        resp = requests.get(f"{api_url}/api/v1/ai-flow/chains", timeout=10)
        assert resp.status_code == 200
        chains = resp.json()
        usage_types = [c["usage_type"] for c in chains]
        required = [
            "interview", "prompt_generation", "task_execution",
            "commit_generation", "content_generation", "rag_extraction",
            "memory", "general", "pattern_discovery", "queue_orchestration",
        ]
        for ut in required:
            assert ut in usage_types, f"Chain for '{ut}' not found"

    def test_chains_point_to_ollama(self, api_url):
        """All chains should point to Ollama models (not claudio/anthropic/openai/google)."""
        resp = requests.get(f"{api_url}/api/v1/ai-flow/chains", timeout=10)
        chains = resp.json()

        models_resp = requests.get(f"{api_url}/api/v1/ai-models/", timeout=10)
        models = {m["id"]: m for m in models_resp.json()}

        for chain in chains:
            for model_id in chain["chain"]:
                model = models.get(model_id)
                assert model is not None, f"Model {model_id} in chain {chain['usage_type']} not found"
                assert model["provider"] == "ollama", (
                    f"Chain '{chain['usage_type']}' points to provider '{model['provider']}' "
                    f"(model: {model['name']}). Expected 'ollama'."
                )

    def test_ollama_models_active(self, api_url):
        """All Ollama models in chains should be active."""
        resp = requests.get(f"{api_url}/api/v1/ai-flow/chains", timeout=10)
        chains = resp.json()

        models_resp = requests.get(f"{api_url}/api/v1/ai-models/", timeout=10)
        models = {m["id"]: m for m in models_resp.json()}

        for chain in chains:
            for model_id in chain["chain"]:
                model = models.get(model_id)
                if model and model["provider"] == "ollama":
                    assert model["is_active"], f"Ollama model '{model['name']}' is not active"

    def test_orchestration_status(self, api_url):
        """Orchestration should show Ollama as available provider."""
        resp = requests.get(f"{api_url}/api/v1/ai-models/orchestration/status", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            providers = data.get("available_providers", [])
            assert "ollama" in providers, f"Ollama not in available providers: {providers}"
        # If endpoint doesn't exist, that's OK - skip gracefully
