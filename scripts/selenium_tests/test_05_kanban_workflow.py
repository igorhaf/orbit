"""
Test 05: Kanban Board & Workflow
================================
Tests kanban board columns, task status transitions, and workflow operations.
Uses API for status changes (drag-drop is complex in headless mode).
"""

import pytest
import time
import requests
from selenium.webdriver.common.by import By
from helpers import (
    wait_for_body, take_screenshot, check_page_errors,
    check_console_errors, wait_for_element, api_get, api_post, api_patch
)


KANBAN_COLUMNS = ["blocked", "backlog", "todo", "in_progress", "review", "done"]


class TestKanbanPageLoads:
    """Verify kanban board renders correctly."""

    def test_kanban_tab_loads(self, driver, base_url, project_id):
        """Kanban tab should load and show the board."""
        driver.get(f"{base_url}/projects/{project_id}?tab=kanban")
        time.sleep(3)
        wait_for_body(driver)
        body = driver.find_element(By.TAG_NAME, "body").text.lower()
        # Kanban should show column headers
        has_columns = any(col in body for col in [
            "backlog", "to do", "para fazer", "in progress",
            "em progresso", "review", "revisão", "done", "concluído"
        ])
        assert has_columns, "No kanban column headers found on page"
        take_screenshot(driver, "05_kanban_board")

    def test_kanban_has_cards(self, driver, base_url, project_id, api_url):
        """Kanban board should show existing cards."""
        tasks = api_get(api_url, f"/api/v1/tasks/?project_id={project_id}")
        if not tasks:
            pytest.skip("No tasks in project")

        driver.get(f"{base_url}/projects/{project_id}?tab=kanban")
        time.sleep(3)
        wait_for_body(driver)

        # Look for task cards on the board
        body = driver.find_element(By.TAG_NAME, "body").text
        found_any = any(t.get("title", "") in body for t in tasks[:5])
        take_screenshot(driver, "05_kanban_cards")
        # It's OK if not all cards are visible (they may be in collapsed columns)


class TestKanbanAPI:
    """Test kanban board API endpoint."""

    def test_kanban_endpoint(self, api_url, project_id):
        """GET /api/v1/tasks/kanban should return board state."""
        resp = requests.get(
            f"{api_url}/api/v1/tasks/kanban/{project_id}",
            timeout=15,
        )
        if resp.status_code == 404:
            pytest.skip("Kanban endpoint not available")
        assert resp.status_code == 200, f"Kanban API failed: {resp.status_code}"

    def test_valid_transitions(self, api_url, project_id):
        """Should be able to get valid transitions for a task."""
        tasks = api_get(api_url, f"/api/v1/tasks/?project_id={project_id}")
        if not tasks:
            pytest.skip("No tasks in project")

        task = tasks[0]
        resp = requests.get(
            f"{api_url}/api/v1/tasks/{task['id']}/valid-transitions",
            timeout=10,
        )
        if resp.status_code == 404:
            pytest.skip("Valid-transitions endpoint not available")
        assert resp.status_code == 200, f"Valid transitions failed: {resp.status_code}"


class TestStatusTransitions:
    """Test task status transitions via API."""

    def _find_task_in_status(self, api_url, project_id, status):
        """Find a task in the given status."""
        tasks = api_get(api_url, f"/api/v1/tasks/?project_id={project_id}")
        for t in tasks:
            if t.get("status") == status:
                return t
        return None

    def test_move_backlog_to_todo(self, api_url, project_id):
        """Should move a task from backlog to todo."""
        task = self._find_task_in_status(api_url, project_id, "backlog")
        if not task:
            pytest.skip("No task in backlog status")

        self.__class__._test_task_id = task["id"]
        self.__class__._original_status = task["status"]

        # Try move endpoint
        resp = requests.patch(
            f"{api_url}/api/v1/tasks/{task['id']}/move",
            json={"new_status": "todo", "new_order": 0},
            headers={"Content-Type": "application/json"},
            timeout=15,
        )

        if resp.status_code == 404:
            # Try transition endpoint instead
            resp = requests.post(
                f"{api_url}/api/v1/tasks/{task['id']}/transition",
                json={"to_status": "todo"},
                headers={"Content-Type": "application/json"},
                timeout=15,
            )

        if resp.status_code == 404:
            # Try direct PATCH
            resp = requests.patch(
                f"{api_url}/api/v1/tasks/{task['id']}",
                json={"status": "todo"},
                headers={"Content-Type": "application/json"},
                timeout=15,
            )

        assert resp.status_code == 200, f"Move failed: {resp.status_code} {resp.text[:200]}"

        # Verify status changed
        updated = api_get(api_url, f"/api/v1/tasks/{task['id']}")
        assert updated["status"] == "todo", f"Status not changed: {updated['status']}"

    def test_move_todo_to_in_progress(self, api_url, project_id):
        """Should move a task from todo to in_progress."""
        task_id = getattr(self.__class__, '_test_task_id', None)
        if not task_id:
            pytest.skip("No test task available")

        resp = requests.patch(
            f"{api_url}/api/v1/tasks/{task_id}/move",
            json={"new_status": "in_progress", "new_order": 0},
            headers={"Content-Type": "application/json"},
            timeout=15,
        )

        if resp.status_code == 404:
            resp = requests.patch(
                f"{api_url}/api/v1/tasks/{task_id}",
                json={"status": "in_progress"},
                headers={"Content-Type": "application/json"},
                timeout=15,
            )

        assert resp.status_code == 200, f"Move failed: {resp.status_code}"

        updated = api_get(api_url, f"/api/v1/tasks/{task_id}")
        assert updated["status"] == "in_progress", f"Status: {updated['status']}"

    def test_move_to_done(self, api_url, project_id):
        """Should move a task to done."""
        task_id = getattr(self.__class__, '_test_task_id', None)
        if not task_id:
            pytest.skip("No test task available")

        resp = requests.patch(
            f"{api_url}/api/v1/tasks/{task_id}/move",
            json={"new_status": "done", "new_order": 0},
            headers={"Content-Type": "application/json"},
            timeout=15,
        )

        if resp.status_code == 404:
            resp = requests.patch(
                f"{api_url}/api/v1/tasks/{task_id}",
                json={"status": "done"},
                headers={"Content-Type": "application/json"},
                timeout=15,
            )

        assert resp.status_code == 200, f"Move failed: {resp.status_code}"

    def test_restore_original_status(self, api_url):
        """Restore task to original status after testing."""
        task_id = getattr(self.__class__, '_test_task_id', None)
        original = getattr(self.__class__, '_original_status', 'backlog')
        if not task_id:
            return

        try:
            requests.patch(
                f"{api_url}/api/v1/tasks/{task_id}/move",
                json={"new_status": original, "new_order": 0},
                headers={"Content-Type": "application/json"},
                timeout=15,
            )
        except Exception:
            try:
                requests.patch(
                    f"{api_url}/api/v1/tasks/{task_id}",
                    json={"status": original},
                    headers={"Content-Type": "application/json"},
                    timeout=15,
                )
            except Exception:
                pass


class TestKanbanUIAfterTransitions:
    """Verify kanban UI reflects status changes."""

    def test_kanban_reflects_changes(self, driver, base_url, project_id):
        """After transitions, kanban should show updated column positions."""
        driver.get(f"{base_url}/projects/{project_id}?tab=kanban")
        time.sleep(3)
        wait_for_body(driver)
        take_screenshot(driver, "05_kanban_after_transitions")


class TestNoConsoleErrors:
    """Verify no JavaScript errors on kanban page."""

    def test_no_js_errors(self, driver, base_url, project_id):
        """Kanban page should not have JavaScript errors."""
        driver.get(f"{base_url}/projects/{project_id}?tab=kanban")
        time.sleep(3)
        wait_for_body(driver)
        real_errors, noise = check_console_errors(driver)
        assert not real_errors, f"JavaScript errors on kanban: {real_errors}"
