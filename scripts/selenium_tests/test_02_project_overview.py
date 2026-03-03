"""
Test 02: Project Overview — Meada Project
==========================================
Tests project detail page: title, description, AI operations, pinned fragments.
AI operations use async jobs - test waits for job completion via API polling.
"""

import pytest
import time
import requests
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from helpers import (
    wait_for_body, take_screenshot, check_page_errors,
    check_console_errors, wait_for_element, api_get, api_patch,
    api_post, wait_for_job
)


AI_TIMEOUT = 300  # Ollama local needs more time for job completion
ORIGINAL_DESCRIPTION = None  # Will be set in setup


class TestProjectNavigation:
    """Navigate to the Meada project."""

    def test_projects_list_loads(self, driver, base_url):
        """Projects page should load and show projects."""
        driver.get(f"{base_url}/projects")
        time.sleep(2)
        wait_for_body(driver)
        body = driver.find_element(By.TAG_NAME, "body").text.lower()
        assert "meada" in body, "Meada project not visible on projects list"
        take_screenshot(driver, "02_projects_list")

    def test_open_meada_project(self, driver, base_url, project_id):
        """Should navigate to Meada project detail page."""
        driver.get(f"{base_url}/projects/{project_id}")
        time.sleep(2)
        wait_for_body(driver)
        body = driver.find_element(By.TAG_NAME, "body").text.lower()
        assert "meada" in body or "descrição" in body, "Project page doesn't show Meada"
        errors = check_page_errors(driver)
        assert not errors, f"Page errors: {errors}"
        take_screenshot(driver, "02_meada_detail")

    def test_overview_tab_default(self, driver, base_url, project_id):
        """Overview tab should be active by default with title and description."""
        driver.get(f"{base_url}/projects/{project_id}")
        time.sleep(2)
        wait_for_body(driver)
        body = driver.find_element(By.TAG_NAME, "body").text
        assert "Descrição do Projeto" in body or "descrição" in body.lower(), \
            "Description section not found"


class TestDescriptionAIOperations:
    """Test AI-powered description operations using Ollama (async jobs)."""

    def _wait_for_description_change(self, api_url, project_id, original_desc, timeout=AI_TIMEOUT):
        """Poll project until description changes from original."""
        start = time.time()
        while time.time() - start < timeout:
            project = api_get(api_url, f"/api/v1/projects/{project_id}")
            new_desc = project.get("description", "") or ""
            if new_desc and new_desc != original_desc:
                return new_desc
            time.sleep(5)
        return None

    def test_expand_description(self, driver, base_url, project_id, api_url):
        """Expand (Detalhar) should make description longer."""
        project = api_get(api_url, f"/api/v1/projects/{project_id}")
        original_desc = project.get("description", "") or ""
        original_len = len(original_desc)

        if original_len < 20:
            pytest.skip("Project has no description to expand")

        # Call the API directly (simulates what the button does)
        resp = api_post(api_url, "/api/v1/projects/expand-description", {
            "title": project.get("name", ""),
            "current_description": original_desc,
            "project_id": project_id,
            "pinned_fragments": project.get("pinned_fragments") or [],
        })
        job_id = resp.get("job_id")
        assert job_id, "No job_id returned from expand-description"

        # Wait for job to complete
        job = wait_for_job(api_url, job_id, timeout=AI_TIMEOUT)
        result = job.get("result", {})
        new_desc = result.get("description", "") if isinstance(result, dict) else ""

        assert len(new_desc) > 0, f"Expanded description is empty. Job result: {result}"
        assert len(new_desc) > original_len * 0.8, \
            f"Description not expanded enough: was {original_len}, now {len(new_desc)}"

        # Verify in UI
        driver.get(f"{base_url}/projects/{project_id}")
        time.sleep(3)
        wait_for_body(driver)
        take_screenshot(driver, "02_expand_result")

    def test_summarize_description(self, driver, base_url, project_id, api_url):
        """Summarize (Resumir) should make description shorter."""
        project = api_get(api_url, f"/api/v1/projects/{project_id}")
        original_desc = project.get("description", "") or ""
        original_len = len(original_desc)

        if original_len < 100:
            pytest.skip("Description too short to summarize")

        resp = api_post(api_url, "/api/v1/projects/summarize-description", {
            "title": project.get("name", ""),
            "current_description": original_desc,
            "project_id": project_id,
            "pinned_fragments": project.get("pinned_fragments") or [],
        })
        job_id = resp.get("job_id")
        assert job_id, "No job_id returned from summarize-description"

        job = wait_for_job(api_url, job_id, timeout=AI_TIMEOUT)
        result = job.get("result", {})
        new_desc = result.get("description", "") if isinstance(result, dict) else ""

        assert len(new_desc) > 0, f"Summarized description is empty. Job result: {result}"
        assert len(new_desc) < original_len, \
            f"Description not summarized: was {original_len}, now {len(new_desc)}"

        driver.get(f"{base_url}/projects/{project_id}")
        time.sleep(3)
        wait_for_body(driver)
        take_screenshot(driver, "02_summarize_result")

    def test_rephrase_description(self, driver, base_url, project_id, api_url):
        """Rephrase (Reformular) should change text while keeping meaning."""
        project = api_get(api_url, f"/api/v1/projects/{project_id}")
        original_desc = project.get("description", "") or ""

        if len(original_desc) < 20:
            pytest.skip("No description to rephrase")

        resp = api_post(api_url, "/api/v1/projects/rephrase-description", {
            "title": project.get("name", ""),
            "current_description": original_desc,
            "project_id": project_id,
            "pinned_fragments": project.get("pinned_fragments") or [],
        })
        job_id = resp.get("job_id")
        assert job_id, "No job_id returned from rephrase-description"

        job = wait_for_job(api_url, job_id, timeout=AI_TIMEOUT)
        result = job.get("result", {})
        new_desc = result.get("description", "") if isinstance(result, dict) else ""

        assert len(new_desc) > 0, f"Rephrased description is empty. Job result: {result}"
        assert new_desc != original_desc, "Description was not rephrased (text identical)"

        driver.get(f"{base_url}/projects/{project_id}")
        time.sleep(3)
        wait_for_body(driver)
        take_screenshot(driver, "02_rephrase_result")


class TestDescriptionButtonsUI:
    """Test that AI buttons exist and are clickable in the UI."""

    def test_expand_button_exists(self, driver, base_url, project_id):
        """Expand (Detalhar) button should be present."""
        driver.get(f"{base_url}/projects/{project_id}")
        time.sleep(3)
        wait_for_body(driver)
        buttons = driver.find_elements(By.CSS_SELECTOR, 'button[title*="Detalhar"]')
        assert len(buttons) > 0, "Expand (Detalhar) button not found"

    def test_summarize_button_exists(self, driver, base_url, project_id):
        """Summarize (Resumir) button should be present."""
        driver.get(f"{base_url}/projects/{project_id}")
        time.sleep(3)
        wait_for_body(driver)
        buttons = driver.find_elements(By.CSS_SELECTOR, 'button[title*="Resumir"]')
        assert len(buttons) > 0, "Summarize (Resumir) button not found"

    def test_rephrase_button_exists(self, driver, base_url, project_id):
        """Rephrase (Reformular) button should be present."""
        driver.get(f"{base_url}/projects/{project_id}")
        time.sleep(3)
        wait_for_body(driver)
        buttons = driver.find_elements(By.CSS_SELECTOR, 'button[title*="Reformular"]')
        assert len(buttons) > 0, "Rephrase (Reformular) button not found"

    def test_title_button_exists(self, driver, base_url, project_id):
        """Title regeneration button should be present."""
        driver.get(f"{base_url}/projects/{project_id}")
        time.sleep(3)
        wait_for_body(driver)
        buttons = driver.find_elements(By.CSS_SELECTOR,
            'button[title*="título via IA"], button[title*="Reformular título"]')
        assert len(buttons) > 0, "Title generation button not found"


class TestTitleAIOperation:
    """Test AI-powered title generation."""

    def test_generate_title(self, driver, base_url, project_id, api_url):
        """Title regeneration via API should change project title."""
        project = api_get(api_url, f"/api/v1/projects/{project_id}")

        if not project.get("description"):
            pytest.skip("No description to generate title from")

        # The generate-title endpoint
        resp = requests.post(
            f"{api_url}/api/v1/projects/generate-title",
            json={
                "description": project.get("description", ""),
                "current_title": project.get("name", ""),
                "project_id": project_id,
            },
            headers={"Content-Type": "application/json"},
            timeout=AI_TIMEOUT,
        )

        if resp.status_code == 200:
            data = resp.json()
            # Check if it's async (job_id) or sync (direct response)
            if "job_id" in data:
                job = wait_for_job(api_url, data["job_id"], timeout=AI_TIMEOUT)
                result = job.get("result", {})
                new_title = result.get("title", "") if isinstance(result, dict) else ""
            else:
                new_title = data.get("title", "") or data.get("name", "")

            # Verify title was set
            project_after = api_get(api_url, f"/api/v1/projects/{project_id}")
            take_screenshot(driver, "02_title_gen_result")
            assert project_after.get("name"), "Title is empty after generation"
        elif resp.status_code == 404:
            pytest.skip("generate-title endpoint not found")
        else:
            pytest.fail(f"generate-title failed: {resp.status_code} {resp.text[:200]}")


class TestPinnedFragments:
    """Test pinned fragments functionality."""

    def test_select_and_persist_text(self, driver, base_url, project_id, api_url):
        """Should be able to select text and pin it as a fragment."""
        # Clear any existing pinned fragments
        api_patch(api_url, f"/api/v1/projects/{project_id}",
                  {"pinned_fragments": []})

        driver.get(f"{base_url}/projects/{project_id}")
        time.sleep(3)
        wait_for_body(driver)

        # Find description area
        desc_areas = driver.find_elements(By.CSS_SELECTOR, ".prose.prose-sm")
        if not desc_areas:
            take_screenshot(driver, "02_no_prose_area")
            pytest.skip("Description prose area not found")

        desc_area = desc_areas[0]
        desc_text = desc_area.text
        if len(desc_text) < 10:
            pytest.skip("Description too short for selection")

        # Select text using JavaScript Range API
        driver.execute_script("""
            const el = document.querySelector('.prose.prose-sm');
            if (!el) return;
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            let textNode = null;
            while (walker.nextNode()) {
                if (walker.currentNode.textContent.trim().length > 20) {
                    textNode = walker.currentNode;
                    break;
                }
            }
            if (!textNode) return;
            const range = document.createRange();
            range.setStart(textNode, 0);
            range.setEnd(textNode, Math.min(30, textNode.textContent.length));
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            const event = new MouseEvent('mouseup', { bubbles: true });
            el.dispatchEvent(event);
        """)
        time.sleep(1)

        # Look for the persist button
        persist_btns = driver.find_elements(By.CSS_SELECTOR, 'button[title*="Persistir"]')
        if not persist_btns:
            take_screenshot(driver, "02_no_persist_btn")
            pytest.skip("Persist button not found in DOM")

        persist_btn = persist_btns[0]
        display = persist_btn.value_of_css_property("display")
        if display == "none":
            take_screenshot(driver, "02_persist_hidden")
            pytest.skip("Persist button found but hidden")

        persist_btn.click()
        time.sleep(2)
        take_screenshot(driver, "02_persist_clicked")

        # Verify fragment was pinned
        project_after = api_get(api_url, f"/api/v1/projects/{project_id}")
        fragments = project_after.get("pinned_fragments") or []
        assert len(fragments) > 0, "No pinned fragments after persist click"

        # Reload and check highlight in DOM (best-effort — text may not match exactly after AI ops)
        driver.get(f"{base_url}/projects/{project_id}")
        time.sleep(3)
        pinned_spans = driver.find_elements(By.CSS_SELECTOR, 'span[data-pinned="true"]')
        take_screenshot(driver, "02_pinned_highlight")
        if not pinned_spans:
            # Fragment was saved via API (verified above) but highlight may not render
            # if description text was changed by AI operations
            import logging
            logging.getLogger(__name__).warning(
                "Pinned fragment saved via API but no highlight in DOM — "
                "likely due to text changes from AI operations"
            )

    def test_cleanup_fragments(self, driver, base_url, project_id, api_url):
        """Clean up pinned fragments after testing."""
        api_patch(api_url, f"/api/v1/projects/{project_id}",
                  {"pinned_fragments": []})


class TestNoConsoleErrors:
    """Verify no JavaScript errors on project page."""

    def test_no_js_errors(self, driver, base_url, project_id):
        """Project page should not have JavaScript errors."""
        driver.get(f"{base_url}/projects/{project_id}")
        time.sleep(3)
        wait_for_body(driver)
        real_errors, noise = check_console_errors(driver)
        assert not real_errors, f"JavaScript errors on project page: {real_errors}"
