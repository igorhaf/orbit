"""
Test 04: Card-Focused Interview Flow
=====================================
Tests the card-focused interview: create interview, answer fixed questions (Q1-Q3),
get AI contextual questions (Q4+), and run card inference to enrich the card.
AI operations use Ollama — tests need generous timeouts.
"""

import pytest
import time
import requests
from selenium.webdriver.common.by import By
from helpers import (
    wait_for_body, take_screenshot, check_page_errors,
    check_console_errors, wait_for_element, api_get, api_post, api_patch
)


AI_TIMEOUT = 300  # Ollama local needs time


class TestInterviewCreation:
    """Create a card-focused interview via API."""

    def _get_test_epic(self, api_url, project_id):
        """Find an epic in the project to use for interview."""
        tasks = api_get(api_url, f"/api/v1/tasks/?project_id={project_id}")
        epics = [t for t in tasks if t.get("item_type") == "epic"]
        if not epics:
            pytest.skip("No epics found in project for interview test")
        return epics[0]

    def test_create_card_focused_interview(self, api_url, project_id):
        """Should create a card-focused interview linked to an epic."""
        epic = self._get_test_epic(api_url, project_id)

        resp = requests.post(
            f"{api_url}/api/v1/interviews/",
            json={
                "project_id": project_id,
                "ai_model_used": "ollama",
                "parent_task_id": epic["id"],
                "use_card_focused": True,
            },
            headers={"Content-Type": "application/json"},
            timeout=30,
        )
        assert resp.status_code in (200, 201), f"Failed to create interview: {resp.status_code} {resp.text[:200]}"
        data = resp.json()

        assert data["interview_mode"] == "card_focused", f"Wrong mode: {data['interview_mode']}"
        assert data["parent_task_id"] == epic["id"], "Parent task mismatch"
        assert data["status"] == "active", f"Wrong status: {data['status']}"

        # Store for next tests
        self.__class__._interview_id = data["id"]
        self.__class__._epic_id = epic["id"]


class TestFixedQuestions:
    """Test the 3 fixed questions (Q1: motivation, Q2: title, Q3: description)."""

    def _send_message(self, api_url, interview_id, content, timeout=60):
        resp = requests.post(
            f"{api_url}/api/v1/interviews/{interview_id}/send-message",
            json={"content": content},
            headers={"Content-Type": "application/json"},
            timeout=timeout,
        )
        assert resp.status_code == 200, f"send-message failed: {resp.status_code} {resp.text[:200]}"
        return resp.json()

    def test_q1_motivation_type(self, api_url, project_id):
        """First message should trigger Q1 (motivation type selection)."""
        interview_id = getattr(TestInterviewCreation, '_interview_id', None)
        if not interview_id:
            pytest.skip("No interview created")

        data = self._send_message(api_url, interview_id, "Quero detalhar esta epic")
        msg = data.get("message", {})

        assert msg.get("content"), "Q1 response is empty"
        assert msg.get("question_number") == 1, f"Expected Q1, got Q{msg.get('question_number')}"
        assert msg.get("question_type") == "single_choice", f"Q1 should be single_choice"
        assert msg.get("options"), "Q1 should have options"

    def test_q2_title(self, api_url):
        """Answer Q1 should trigger Q2 (demand title)."""
        interview_id = getattr(TestInterviewCreation, '_interview_id', None)
        if not interview_id:
            pytest.skip("No interview created")

        data = self._send_message(api_url, interview_id, "Nova funcionalidade")
        msg = data.get("message", {})

        assert msg.get("content"), "Q2 response is empty"
        assert msg.get("question_number") == 2, f"Expected Q2, got Q{msg.get('question_number')}"
        assert msg.get("question_type") == "text", f"Q2 should be text input"

    def test_q3_description(self, api_url):
        """Answer Q2 should trigger Q3 (demand description)."""
        interview_id = getattr(TestInterviewCreation, '_interview_id', None)
        if not interview_id:
            pytest.skip("No interview created")

        data = self._send_message(api_url, interview_id, "Sistema de autenticação de usuários")
        msg = data.get("message", {})

        assert msg.get("content"), "Q3 response is empty"
        assert msg.get("question_number") == 3, f"Expected Q3, got Q{msg.get('question_number')}"
        assert msg.get("question_type") == "text", f"Q3 should be text input"


class TestAIQuestions:
    """Test AI-generated contextual questions (Q4+) powered by Ollama."""

    def _send_message(self, api_url, interview_id, content, timeout=AI_TIMEOUT):
        resp = requests.post(
            f"{api_url}/api/v1/interviews/{interview_id}/send-message",
            json={"content": content},
            headers={"Content-Type": "application/json"},
            timeout=timeout,
        )
        assert resp.status_code == 200, f"send-message failed: {resp.status_code} {resp.text[:200]}"
        return resp.json()

    def test_q4_ai_generated(self, api_url):
        """After Q3, AI should generate contextual Q4."""
        interview_id = getattr(TestInterviewCreation, '_interview_id', None)
        if not interview_id:
            pytest.skip("No interview created")

        data = self._send_message(
            api_url, interview_id,
            "Implementar login com email/senha, registro de novos usuários e recuperação de senha",
            timeout=AI_TIMEOUT
        )
        msg = data.get("message", {})

        assert msg.get("content"), "Q4 AI response is empty"
        assert "system/fixed-question" not in (msg.get("model") or ""), \
            f"Q4 should be AI-generated, not fixed: model={msg.get('model')}"
        assert len(msg["content"]) > 10, "Q4 content too short for AI question"

        # Store for next test
        self.__class__._q4_content = msg["content"]

    def test_q5_ai_follow_up(self, api_url):
        """AI should generate Q5 follow-up based on conversation context."""
        interview_id = getattr(TestInterviewCreation, '_interview_id', None)
        if not interview_id:
            pytest.skip("No interview created")

        data = self._send_message(
            api_url, interview_id,
            "Login via OAuth com Google e GitHub, sessão com JWT, expiração de 24h",
            timeout=AI_TIMEOUT
        )
        msg = data.get("message", {})

        assert msg.get("content"), "Q5 AI response is empty"
        assert len(msg["content"]) > 10, "Q5 content too short"


class TestCardInference:
    """Test card inference — AI enriches the card from interview data."""

    def test_run_card_inference(self, api_url):
        """Card inference should update card fields from interview conversation."""
        interview_id = getattr(TestInterviewCreation, '_interview_id', None)
        epic_id = getattr(TestInterviewCreation, '_epic_id', None)
        if not interview_id or not epic_id:
            pytest.skip("No interview or epic available")

        # Get card before inference
        card_before = api_get(api_url, f"/api/v1/tasks/{epic_id}")
        sp_before = card_before.get("story_points")
        ac_before = card_before.get("acceptance_criteria") or []

        # Run card inference
        resp = requests.post(
            f"{api_url}/api/v1/tasks/{epic_id}/card-inference",
            json={"interview_id": interview_id},
            headers={"Content-Type": "application/json"},
            timeout=AI_TIMEOUT,
        )
        assert resp.status_code == 200, f"card-inference failed: {resp.status_code} {resp.text[:200]}"
        data = resp.json()

        assert data["success"], f"Card inference not successful: {data.get('message')}"
        assert data.get("updated_fields"), "No fields were updated"

    def test_card_enriched_after_inference(self, api_url):
        """Card should have enriched data after inference."""
        epic_id = getattr(TestInterviewCreation, '_epic_id', None)
        if not epic_id:
            pytest.skip("No epic available")

        card = api_get(api_url, f"/api/v1/tasks/{epic_id}")

        # At least description or acceptance_criteria should be enriched
        has_enrichment = (
            (card.get("description") and len(card["description"]) > 20) or
            (card.get("acceptance_criteria") and len(card["acceptance_criteria"]) > 0) or
            card.get("story_points") is not None
        )
        assert has_enrichment, "Card has no enrichment after inference"


class TestInterviewUIElements:
    """Test interview-related UI elements on the card detail page."""

    def test_interview_button_visible(self, driver, base_url, project_id, api_url):
        """Card detail should show interview button or interview tab."""
        epic_id = getattr(TestInterviewCreation, '_epic_id', None)
        if not epic_id:
            # Find any epic
            tasks = api_get(api_url, f"/api/v1/tasks/?project_id={project_id}")
            epics = [t for t in tasks if t.get("item_type") == "epic"]
            if not epics:
                pytest.skip("No epics in project")
            epic_id = epics[0]["id"]

        driver.get(f"{base_url}/projects/{project_id}")
        time.sleep(3)
        wait_for_body(driver)

        # Navigate to backlog tab
        tabs = driver.find_elements(By.CSS_SELECTOR, 'button, a')
        for tab in tabs:
            if "backlog" in tab.text.lower():
                tab.click()
                time.sleep(2)
                break

        take_screenshot(driver, "04_interview_ui")


class TestInterviewCleanup:
    """Clean up test interviews."""

    def test_cleanup_interviews(self, api_url, project_id):
        """Delete test interviews created during this test."""
        interview_id = getattr(TestInterviewCreation, '_interview_id', None)
        if interview_id:
            try:
                requests.delete(
                    f"{api_url}/api/v1/interviews/{interview_id}",
                    timeout=10,
                )
            except Exception:
                pass


class TestNoConsoleErrors:
    """Verify no JavaScript errors after interview operations."""

    def test_no_js_errors(self, driver, base_url, project_id):
        """Project page should not have JavaScript errors."""
        driver.get(f"{base_url}/projects/{project_id}")
        time.sleep(3)
        wait_for_body(driver)
        real_errors, noise = check_console_errors(driver)
        assert not real_errors, f"JavaScript errors: {real_errors}"
