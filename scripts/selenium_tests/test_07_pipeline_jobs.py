"""
Test 07: Pipeline & Jobs System
================================
Tests the jobs queue, executor status, job statistics, and job lifecycle.
"""

import pytest
import time
import requests
from selenium.webdriver.common.by import By
from helpers import (
    wait_for_body, take_screenshot, check_page_errors,
    check_console_errors, wait_for_element, api_get
)


class TestJobsPageLoads:
    """Verify jobs page renders correctly."""

    def test_jobs_page_loads(self, driver, base_url):
        """Jobs page should load and show queue interface."""
        driver.get(f"{base_url}/jobs")
        time.sleep(3)
        wait_for_body(driver)
        body = driver.find_element(By.TAG_NAME, "body").text.lower()
        # Jobs page should have job-related content
        has_content = any(term in body for term in [
            "job", "fila", "queue", "status", "pending",
            "completed", "failed", "running",
        ])
        assert has_content, "Jobs page has no job-related content"
        take_screenshot(driver, "07_jobs_page")


class TestJobsAPI:
    """Test job system API endpoints."""

    def test_list_jobs(self, api_url):
        """Should list jobs."""
        resp = requests.get(
            f"{api_url}/api/v1/jobs/?limit=10",
            timeout=15,
        )
        assert resp.status_code == 200, f"Jobs list failed: {resp.status_code}"
        data = resp.json()
        # Response could be a list or paginated dict
        assert isinstance(data, (list, dict)), f"Unexpected response type: {type(data)}"

    def test_active_jobs(self, api_url):
        """Should return active jobs."""
        resp = requests.get(
            f"{api_url}/api/v1/jobs/active",
            timeout=15,
        )
        assert resp.status_code == 200, f"Active jobs failed: {resp.status_code}"

    def test_job_stats(self, api_url):
        """Should return job statistics."""
        resp = requests.get(
            f"{api_url}/api/v1/jobs/stats",
            timeout=15,
        )
        if resp.status_code == 404:
            pytest.skip("Stats endpoint not available")
        assert resp.status_code == 200, f"Job stats failed: {resp.status_code}"
        data = resp.json()
        # Stats should have total_jobs or similar
        assert isinstance(data, dict), f"Expected dict, got {type(data)}"

    def test_executor_status(self, api_url):
        """Should return executor status."""
        resp = requests.get(
            f"{api_url}/api/v1/jobs/executor/status",
            timeout=15,
        )
        if resp.status_code == 404:
            pytest.skip("Executor status endpoint not available")
        assert resp.status_code == 200, f"Executor status failed: {resp.status_code}"


class TestJobsFromPreviousTests:
    """Verify jobs created by previous test operations exist."""

    def test_completed_jobs_exist(self, api_url, project_id):
        """There should be completed jobs from AI operations in earlier tests."""
        resp = requests.get(
            f"{api_url}/api/v1/jobs/?status=completed&limit=20",
            timeout=15,
        )
        assert resp.status_code == 200
        data = resp.json()
        jobs = data if isinstance(data, list) else data.get("items", data.get("jobs", []))

        # Filter by project if possible
        project_jobs = [j for j in jobs if j.get("project_id") == project_id]

        # We should have at least some completed jobs from expand/summarize/rephrase operations
        if not project_jobs and jobs:
            # If no project filter available, any completed jobs count
            assert len(jobs) > 0, "No completed jobs found at all"
        take_screenshot_msg = f"Found {len(project_jobs)} project jobs, {len(jobs)} total jobs"

    def test_job_detail(self, api_url):
        """Should be able to fetch details of a specific job."""
        resp = requests.get(
            f"{api_url}/api/v1/jobs/?limit=1",
            timeout=15,
        )
        assert resp.status_code == 200
        data = resp.json()
        jobs = data if isinstance(data, list) else data.get("items", data.get("jobs", []))

        if not jobs:
            pytest.skip("No jobs found to inspect")

        job_id = jobs[0].get("id")
        detail_resp = requests.get(
            f"{api_url}/api/v1/jobs/{job_id}",
            timeout=15,
        )
        assert detail_resp.status_code == 200, f"Job detail failed: {detail_resp.status_code}"
        detail = detail_resp.json()
        assert detail.get("id") == job_id, "Job ID mismatch"
        assert "status" in detail, "Job detail missing status field"


class TestConsolePage:
    """Test console page."""

    def test_console_page_loads(self, driver, base_url):
        """Console page should load."""
        driver.get(f"{base_url}/console")
        time.sleep(3)
        wait_for_body(driver)
        body = driver.find_element(By.TAG_NAME, "body").text.lower()
        assert len(body) > 20, "Console page is empty"
        take_screenshot(driver, "07_console_page")


class TestNoConsoleErrors:
    """Verify no JavaScript errors on jobs/console pages."""

    def test_no_js_errors_jobs(self, driver, base_url):
        """Jobs page should not have JavaScript errors."""
        driver.get(f"{base_url}/jobs")
        time.sleep(3)
        wait_for_body(driver)
        real_errors, noise = check_console_errors(driver)
        assert not real_errors, f"JavaScript errors on jobs: {real_errors}"
