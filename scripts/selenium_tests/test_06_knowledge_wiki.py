"""
Test 06: Wiki & Knowledge Base
===============================
Tests wiki page CRUD, tree structure, and RAG-related UI elements.
"""

import pytest
import time
import requests
from selenium.webdriver.common.by import By
from helpers import (
    wait_for_body, take_screenshot, check_page_errors,
    check_console_errors, wait_for_element, api_get, api_post, api_patch
)


class TestWikiPageLoads:
    """Verify wiki tab loads correctly."""

    def test_wiki_tab_loads(self, driver, base_url, project_id):
        """Wiki tab should load and show content."""
        driver.get(f"{base_url}/projects/{project_id}?tab=wiki")
        time.sleep(3)
        wait_for_body(driver)
        body = driver.find_element(By.TAG_NAME, "body").text.lower()
        # Wiki page should have some content or empty state
        assert len(body) > 50, "Wiki page body is too short"
        take_screenshot(driver, "06_wiki_tab")


class TestWikiAPI:
    """Test wiki CRUD operations via API."""

    def test_list_wiki_pages(self, api_url, project_id):
        """Should list wiki pages for the project."""
        resp = requests.get(
            f"{api_url}/api/v1/projects/{project_id}/wiki",
            timeout=15,
        )
        if resp.status_code == 404:
            pytest.skip("Wiki endpoint not available")
        assert resp.status_code == 200, f"Wiki list failed: {resp.status_code}"
        data = resp.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        self.__class__._initial_count = len(data)

    def test_create_wiki_page(self, api_url, project_id):
        """Should create a new wiki page."""
        page_data = {
            "title": "Teste Selenium - Página Wiki",
            "slug": "teste-selenium-wiki",
            "content": "# Página de Teste\n\nEsta página foi criada automaticamente pelo teste Selenium.\n\n## Seções\n\n- Item 1\n- Item 2\n- Item 3",
            "source": "manual",
        }

        resp = requests.post(
            f"{api_url}/api/v1/projects/{project_id}/wiki",
            json=page_data,
            headers={"Content-Type": "application/json"},
            timeout=15,
        )
        if resp.status_code == 404:
            pytest.skip("Wiki create endpoint not available")

        if resp.status_code == 409:
            # Page already exists — that's OK for re-runs
            self.__class__._wiki_slug = "teste-selenium-wiki"
            return

        assert resp.status_code in (200, 201), f"Wiki create failed: {resp.status_code} {resp.text[:200]}"
        self.__class__._wiki_slug = "teste-selenium-wiki"

    def test_read_wiki_page(self, api_url, project_id):
        """Should read the created wiki page."""
        slug = getattr(self.__class__, '_wiki_slug', 'teste-selenium-wiki')

        resp = requests.get(
            f"{api_url}/api/v1/projects/{project_id}/wiki/{slug}",
            timeout=15,
        )
        if resp.status_code == 404:
            pytest.skip("Wiki page not found")
        assert resp.status_code == 200, f"Wiki read failed: {resp.status_code}"
        data = resp.json()
        assert data.get("title") or data.get("slug"), "Wiki page has no title or slug"

    def test_update_wiki_page(self, api_url, project_id):
        """Should update the wiki page content."""
        slug = getattr(self.__class__, '_wiki_slug', 'teste-selenium-wiki')

        update_data = {
            "title": "Teste Selenium - Página Wiki (atualizada)",
            "content": "# Página Atualizada\n\nConteúdo atualizado pelo teste Selenium.\n\n## Novas Seções\n\n- Item A\n- Item B",
        }

        resp = requests.put(
            f"{api_url}/api/v1/projects/{project_id}/wiki/{slug}",
            json=update_data,
            headers={"Content-Type": "application/json"},
            timeout=15,
        )
        if resp.status_code == 404:
            pytest.skip("Wiki update endpoint not available")
        assert resp.status_code == 200, f"Wiki update failed: {resp.status_code} {resp.text[:200]}"

    def test_wiki_tree(self, api_url, project_id):
        """Should get wiki page tree structure."""
        resp = requests.get(
            f"{api_url}/api/v1/projects/{project_id}/wiki/tree",
            timeout=15,
        )
        if resp.status_code == 404:
            pytest.skip("Wiki tree endpoint not available")
        assert resp.status_code == 200, f"Wiki tree failed: {resp.status_code}"

    def test_delete_wiki_page(self, api_url, project_id):
        """Should delete the test wiki page (cleanup)."""
        slug = getattr(self.__class__, '_wiki_slug', 'teste-selenium-wiki')

        resp = requests.delete(
            f"{api_url}/api/v1/projects/{project_id}/wiki/{slug}",
            timeout=15,
        )
        # 200, 204 or 404 are all acceptable
        assert resp.status_code in (200, 204, 404), f"Wiki delete failed: {resp.status_code}"


class TestRAGUI:
    """Test RAG-related UI elements."""

    def test_rag_tab_loads(self, driver, base_url, project_id):
        """RAG tab should load."""
        driver.get(f"{base_url}/projects/{project_id}?tab=rag")
        time.sleep(3)
        wait_for_body(driver)
        body = driver.find_element(By.TAG_NAME, "body").text.lower()
        assert len(body) > 30, "RAG page body is too short"
        take_screenshot(driver, "06_rag_tab")

    def test_chat_tab_loads(self, driver, base_url, project_id):
        """Chat tab should load."""
        driver.get(f"{base_url}/projects/{project_id}?tab=chat")
        time.sleep(3)
        wait_for_body(driver)
        body = driver.find_element(By.TAG_NAME, "body").text.lower()
        assert len(body) > 30, "Chat page body is too short"
        take_screenshot(driver, "06_chat_tab")


class TestRAGEnrichmentStatus:
    """Test RAG enrichment status endpoint."""

    def test_enrichment_status(self, api_url, project_id):
        """Should return enrichment status for the project."""
        resp = requests.get(
            f"{api_url}/api/v1/projects/{project_id}/rag/enrichment-status",
            timeout=15,
        )
        if resp.status_code == 404:
            pytest.skip("Enrichment status endpoint not available")
        assert resp.status_code == 200, f"Enrichment status failed: {resp.status_code}"


class TestNoConsoleErrors:
    """Verify no JavaScript errors on wiki/RAG pages."""

    def test_no_js_errors_wiki(self, driver, base_url, project_id):
        """Wiki page should not have JavaScript errors."""
        driver.get(f"{base_url}/projects/{project_id}?tab=wiki")
        time.sleep(3)
        wait_for_body(driver)
        real_errors, noise = check_console_errors(driver)
        assert not real_errors, f"JavaScript errors on wiki: {real_errors}"
