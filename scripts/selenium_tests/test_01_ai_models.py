"""
Test 01: AI Models & AI Flow Page Verification
================================================
Tests the AI Models management page and AI Studio (Flow) page via Selenium.
"""

import pytest
import time
from selenium.webdriver.common.by import By
from helpers import (
    wait_for_body, take_screenshot, check_page_errors,
    check_console_errors, click_button_by_text, wait_for_element
)


class TestAIModelsPage:
    """Test the /ai-models page."""

    def test_page_loads(self, driver, base_url):
        """AI Models page should load without errors."""
        driver.get(f"{base_url}/ai-models")
        time.sleep(2)
        wait_for_body(driver)
        errors = check_page_errors(driver)
        assert not errors, f"Page errors: {errors}"

    def test_ollama_models_visible(self, driver, base_url):
        """Ollama models should be visible on the page."""
        driver.get(f"{base_url}/ai-models")
        time.sleep(2)
        wait_for_body(driver)
        body = driver.find_element(By.TAG_NAME, "body").text.lower()
        assert "ollama" in body, "Text 'ollama' not found on AI Models page"
        take_screenshot(driver, "01_ai_models_page")

    def test_model_names_present(self, driver, base_url):
        """Key Ollama model names should appear on the page."""
        driver.get(f"{base_url}/ai-models")
        time.sleep(2)
        wait_for_body(driver)
        body = driver.find_element(By.TAG_NAME, "body").text.lower()
        # Check for at least one of the known model names
        found = []
        for keyword in ["qwen", "ollama", "gemma"]:
            if keyword in body:
                found.append(keyword)
        assert len(found) > 0, f"No Ollama-related model names found on page"

    def test_no_console_errors(self, driver, base_url):
        """No real console errors on AI Models page."""
        driver.get(f"{base_url}/ai-models")
        time.sleep(2)
        wait_for_body(driver)
        real_errors, noise = check_console_errors(driver)
        assert not real_errors, f"Console errors: {real_errors}"


class TestAIFlowPage:
    """Test the /ai-flow (AI Studio) page."""

    def test_page_loads(self, driver, base_url):
        """AI Flow page should load without errors."""
        driver.get(f"{base_url}/ai-flow")
        time.sleep(2)
        wait_for_body(driver)
        errors = check_page_errors(driver)
        assert not errors, f"Page errors: {errors}"

    def test_has_content(self, driver, base_url):
        """AI Flow page should have meaningful content."""
        driver.get(f"{base_url}/ai-flow")
        time.sleep(2)
        wait_for_body(driver)
        body = driver.find_element(By.TAG_NAME, "body").text
        assert len(body.strip()) > 50, f"AI Flow page has too little content ({len(body)} chars)"
        take_screenshot(driver, "01_ai_flow_page")

    def test_no_console_errors(self, driver, base_url):
        """No real console errors on AI Flow page."""
        driver.get(f"{base_url}/ai-flow")
        time.sleep(2)
        wait_for_body(driver)
        real_errors, noise = check_console_errors(driver)
        assert not real_errors, f"Console errors: {real_errors}"
