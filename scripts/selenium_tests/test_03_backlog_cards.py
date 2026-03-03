"""
Test 03: Backlog & Card Generation
====================================
Tests card CRUD, epic creation, story/task generation via AI, and approval workflow.
Uses the Meada project with Ollama models.
"""

import pytest
import time
import requests
from selenium.webdriver.common.by import By
from helpers import (
    wait_for_body, take_screenshot, check_page_errors,
    api_get, api_post, api_patch, api_delete, wait_for_job,
    click_button_by_text, click_tab
)


AI_TIMEOUT = 300
PROJECT_ID = "2f663753-f159-4391-b152-5d31c9b8f9d6"


class TestBacklogPageLoads:
    """Verify backlog tab loads correctly."""

    def test_backlog_tab_loads(self, driver, base_url, project_id):
        """Backlog tab should load without errors."""
        driver.get(f"{base_url}/projects/{project_id}")
        time.sleep(2)
        wait_for_body(driver)
        click_tab(driver, "Backlog")
        time.sleep(2)
        errors = check_page_errors(driver)
        assert not errors, f"Page errors: {errors}"
        take_screenshot(driver, "03_backlog_tab")


class TestManualCardCreation:
    """Test creating cards manually via API."""

    def test_create_epic(self, api_url):
        """Should create an epic card for the Meada project."""
        data = {
            "title": "Página Inicial do Site",
            "description": "Desenvolvimento da landing page institucional da Meada Digital com hero section, serviços e CTA",
            "item_type": "epic",
            "status": "backlog",
            "project_id": PROJECT_ID,
            "priority": "high",
        }
        resp = api_post(api_url, "/api/v1/tasks/", data)
        assert resp.get("id"), "Epic not created"
        assert resp.get("item_type") == "epic", f"Item type wrong: {resp.get('item_type')}"
        assert resp.get("title") == "Página Inicial do Site"

    def test_create_second_epic(self, api_url):
        """Should create a second epic for navigation."""
        data = {
            "title": "Navegação e Menu Principal",
            "description": "Implementar menu responsivo com links para todas as seções do site",
            "item_type": "epic",
            "status": "backlog",
            "project_id": PROJECT_ID,
        }
        resp = api_post(api_url, "/api/v1/tasks/", data)
        assert resp.get("id"), "Second epic not created"
        assert resp.get("item_type") == "epic"

    def test_create_story_under_epic(self, api_url):
        """Should create a story as child of the first epic."""
        # Get the first epic
        tasks = api_get(api_url, f"/api/v1/tasks/",
                       params={"project_id": PROJECT_ID})
        epics = [t for t in tasks if t.get("item_type") == "epic"]
        assert len(epics) > 0, "No epics found"
        epic_id = epics[0]["id"]

        data = {
            "title": "Hero Section com imagem de destaque",
            "description": "Criar hero section com título, subtítulo e CTA principal",
            "item_type": "story",
            "status": "backlog",
            "project_id": PROJECT_ID,
            "parent_id": epic_id,
        }
        resp = api_post(api_url, "/api/v1/tasks/", data)
        assert resp.get("id"), "Story not created"
        assert resp.get("item_type") == "story"
        assert resp.get("parent_id") == epic_id

    def test_create_task_under_story(self, api_url):
        """Should create a task as child of the story."""
        tasks = api_get(api_url, f"/api/v1/tasks/",
                       params={"project_id": PROJECT_ID})
        stories = [t for t in tasks if t.get("item_type") == "story"]
        assert len(stories) > 0, "No stories found"
        story_id = stories[0]["id"]

        data = {
            "title": "Implementar componente HeroSection em React",
            "description": "Criar componente React com Tailwind CSS para hero section",
            "item_type": "task",
            "status": "backlog",
            "project_id": PROJECT_ID,
            "parent_id": story_id,
        }
        resp = api_post(api_url, "/api/v1/tasks/", data)
        assert resp.get("id"), "Task not created"
        assert resp.get("item_type") == "task"

    def test_verify_hierarchy(self, api_url):
        """Verify the created hierarchy: Epic > Story > Task."""
        tasks = api_get(api_url, f"/api/v1/tasks/",
                       params={"project_id": PROJECT_ID})
        epics = [t for t in tasks if t.get("item_type") == "epic"]
        stories = [t for t in tasks if t.get("item_type") == "story"]
        task_items = [t for t in tasks if t.get("item_type") == "task"]

        assert len(epics) >= 2, f"Expected 2+ epics, got {len(epics)}"
        assert len(stories) >= 1, f"Expected 1+ stories, got {len(stories)}"
        assert len(task_items) >= 1, f"Expected 1+ tasks, got {len(task_items)}"

        # Verify parent-child relationships
        story = stories[0]
        assert story["parent_id"] in [e["id"] for e in epics], "Story not linked to epic"
        task_item = task_items[0]
        assert task_item["parent_id"] in [s["id"] for s in stories], "Task not linked to story"

    def test_backlog_shows_cards(self, driver, base_url, project_id):
        """Backlog should show the created cards."""
        driver.get(f"{base_url}/projects/{project_id}")
        time.sleep(2)
        wait_for_body(driver)
        click_tab(driver, "Backlog")
        time.sleep(3)
        body = driver.find_element(By.TAG_NAME, "body").text
        assert "Página Inicial" in body or "Hero" in body or "epic" in body.lower(), \
            f"Cards not visible in backlog. Body preview: {body[:300]}"
        take_screenshot(driver, "03_backlog_with_cards")


class TestAICardGeneration:
    """Test generating child cards via AI (Ollama)."""

    def test_generate_stories_from_epic(self, api_url):
        """Should generate stories from an epic using AI."""
        tasks = api_get(api_url, f"/api/v1/tasks/",
                       params={"project_id": PROJECT_ID})
        epics = [t for t in tasks if t.get("item_type") == "epic"]
        assert len(epics) > 0, "No epics to generate from"

        # Use the second epic (no children yet)
        epic = epics[-1]
        epic_id = epic["id"]

        try:
            resp = api_post(api_url, f"/api/v1/tasks/{epic_id}/generate-children",
                           {"count": 3})
            job_id = resp.get("job_id")
            if not job_id:
                pytest.skip(f"generate-children returned no job_id: {resp}")

            # Wait for job
            job = wait_for_job(api_url, job_id, timeout=AI_TIMEOUT)
            assert job["status"] == "completed", f"Job status: {job['status']}"

            # Check if stories were created
            tasks_after = api_get(api_url, f"/api/v1/tasks/",
                                params={"project_id": PROJECT_ID})
            new_stories = [t for t in tasks_after
                          if t.get("item_type") == "story" and t.get("parent_id") == epic_id]
            assert len(new_stories) > 0, "No stories generated from epic"

        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                pytest.skip("generate-children endpoint not found")
            raise

    def test_generate_tasks_from_story(self, api_url):
        """Should generate tasks from a story using AI."""
        tasks = api_get(api_url, f"/api/v1/tasks/",
                       params={"project_id": PROJECT_ID})
        stories = [t for t in tasks if t.get("item_type") == "story"]

        if not stories:
            pytest.skip("No stories to generate tasks from")

        story = stories[0]
        story_id = story["id"]

        try:
            resp = api_post(api_url, f"/api/v1/tasks/{story_id}/generate-children",
                           {"count": 3})
            job_id = resp.get("job_id")
            if not job_id:
                pytest.skip(f"generate-children returned no job_id: {resp}")

            job = wait_for_job(api_url, job_id, timeout=AI_TIMEOUT)
            assert job["status"] == "completed", f"Job status: {job['status']}"

            tasks_after = api_get(api_url, f"/api/v1/tasks/",
                                params={"project_id": PROJECT_ID})
            new_tasks = [t for t in tasks_after
                        if t.get("item_type") == "task" and t.get("parent_id") == story_id]
            assert len(new_tasks) > 0, "No tasks generated from story"

        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                pytest.skip("generate-children endpoint not found")
            raise


class TestCardEditing:
    """Test editing cards via API."""

    def test_update_card_title(self, api_url):
        """Should be able to update a card's title."""
        tasks = api_get(api_url, f"/api/v1/tasks/",
                       params={"project_id": PROJECT_ID})
        assert len(tasks) > 0, "No tasks to edit"
        task = tasks[0]

        updated = api_patch(api_url, f"/api/v1/tasks/{task['id']}",
                           {"title": f"{task['title']} (editado)"})
        assert "(editado)" in updated.get("title", "")

    def test_update_card_description(self, api_url):
        """Should be able to update a card's description."""
        tasks = api_get(api_url, f"/api/v1/tasks/",
                       params={"project_id": PROJECT_ID})
        assert len(tasks) > 0, "No tasks to edit"
        task = tasks[0]

        updated = api_patch(api_url, f"/api/v1/tasks/{task['id']}",
                           {"description": "Descrição atualizada pelo teste funcional"})
        assert updated.get("description") == "Descrição atualizada pelo teste funcional"

    def test_update_card_priority(self, api_url):
        """Should be able to change card priority."""
        tasks = api_get(api_url, f"/api/v1/tasks/",
                       params={"project_id": PROJECT_ID})
        assert len(tasks) > 0
        task = tasks[0]

        updated = api_patch(api_url, f"/api/v1/tasks/{task['id']}",
                           {"priority": "critical"})
        assert updated.get("priority") == "critical"


class TestBacklogVerification:
    """Final verification of backlog state."""

    def test_final_card_count(self, api_url):
        """Verify the project has multiple cards at different hierarchy levels."""
        tasks = api_get(api_url, f"/api/v1/tasks/",
                       params={"project_id": PROJECT_ID})
        by_type = {}
        for t in tasks:
            item_type = t.get("item_type", "unknown")
            by_type[item_type] = by_type.get(item_type, 0) + 1

        assert len(tasks) >= 4, f"Expected 4+ cards, got {len(tasks)}: {by_type}"
        assert by_type.get("epic", 0) >= 2, f"Expected 2+ epics: {by_type}"

    def test_backlog_ui_final(self, driver, base_url, project_id):
        """Final screenshot of the backlog with all cards."""
        driver.get(f"{base_url}/projects/{project_id}")
        time.sleep(2)
        wait_for_body(driver)
        click_tab(driver, "Backlog")
        time.sleep(3)
        take_screenshot(driver, "03_backlog_final")
        body = driver.find_element(By.TAG_NAME, "body").text
        assert len(body) > 100, "Backlog page has too little content"
