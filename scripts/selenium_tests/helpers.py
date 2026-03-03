"""
ORBIT Selenium Test Helpers
============================
Shared utilities for all functional tests.
"""

import os
import time
import json
import requests
from datetime import datetime

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), "screenshots")

# Console error patterns that are expected noise
NOISE_PATTERNS = [
    "WebSocket error",
    "Job Queue WebSocket error",
    "webpack-internal://",
    "favicon.ico",
    "net::ERR_CONNECTION_REFUSED",
    "ws://",
    "wss://",
    "settings/allow_protected",  # Known 422 - settings key format mismatch
    "422 (Unprocessable Entity)",  # Pydantic validation errors (non-critical)
]


def take_screenshot(driver, name: str) -> str:
    """Save a screenshot with timestamp. Returns the file path."""
    os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{ts}_{name}.png"
    filepath = os.path.join(SCREENSHOTS_DIR, filename)
    driver.save_screenshot(filepath)
    return filepath


def wait_for_body(driver, timeout=15):
    """Wait for body to have meaningful content."""
    WebDriverWait(driver, timeout).until(
        lambda d: len(d.find_element(By.TAG_NAME, "body").text.strip()) > 5
    )


def wait_for_element(driver, selector: str, timeout=15, by=By.CSS_SELECTOR):
    """Wait for an element to be present and return it."""
    return WebDriverWait(driver, timeout).until(
        EC.presence_of_element_located((by, selector))
    )


def wait_for_element_visible(driver, selector: str, timeout=15, by=By.CSS_SELECTOR):
    """Wait for an element to be visible and return it."""
    return WebDriverWait(driver, timeout).until(
        EC.visibility_of_element_located((by, selector))
    )


def wait_for_element_clickable(driver, selector: str, timeout=15, by=By.CSS_SELECTOR):
    """Wait for an element to be clickable and return it."""
    return WebDriverWait(driver, timeout).until(
        EC.element_to_be_clickable((by, selector))
    )


def wait_for_text_in_body(driver, text: str, timeout=15):
    """Wait for specific text to appear in the page body."""
    WebDriverWait(driver, timeout).until(
        lambda d: text.lower() in d.find_element(By.TAG_NAME, "body").text.lower()
    )


def wait_for_ai_response(driver, timeout=180):
    """
    Wait for an AI response to complete by watching for loading indicators to disappear.
    Looks for common loading patterns: spinners, loading text, disabled buttons.
    """
    time.sleep(2)  # Initial wait for request to start

    # Wait for any loading spinner to disappear
    try:
        WebDriverWait(driver, timeout).until_not(
            EC.presence_of_element_located((By.CSS_SELECTOR,
                "[class*='animate-spin'], [class*='loading'], [class*='spinner']"
            ))
        )
    except Exception:
        pass

    # Also wait for any "Gerando..." or "Carregando..." text to disappear
    try:
        WebDriverWait(driver, timeout).until_not(
            lambda d: any(
                word in d.find_element(By.TAG_NAME, "body").text.lower()
                for word in ["gerando...", "carregando...", "processando..."]
            )
        )
    except Exception:
        pass

    time.sleep(1)  # Brief settle time


def click_button_by_text(driver, text: str, timeout=10, partial=False):
    """Find and click a button by its text content."""
    buttons = driver.find_elements(By.TAG_NAME, "button")
    for btn in buttons:
        btn_text = btn.text.strip()
        if partial:
            if text.lower() in btn_text.lower():
                btn.click()
                return btn
        else:
            if btn_text == text:
                btn.click()
                return btn
    raise Exception(f"Button with text '{text}' not found. Available: {[b.text.strip() for b in buttons[:20]]}")


def click_tab(driver, tab_name: str, timeout=10):
    """Click a project tab by name and wait for content change."""
    btn = click_button_by_text(driver, tab_name)
    time.sleep(1.5)
    return btn


def check_console_errors(driver) -> tuple:
    """
    Collect console errors, separating real errors from noise.
    Returns (real_errors, noise_warnings).
    """
    real, noise = [], []
    try:
        for entry in driver.get_log("browser"):
            if entry.get("level") != "SEVERE":
                continue
            msg = entry["message"]
            if any(p in msg for p in NOISE_PATTERNS):
                noise.append(msg)
            else:
                real.append(msg)
    except Exception:
        pass
    return real, noise


def check_page_errors(driver) -> list:
    """Check if the page shows any error messages."""
    body = driver.find_element(By.TAG_NAME, "body").text.lower()
    errors = []
    for pattern, label in [
        ("internal server error", "Internal Server Error"),
        ("application error", "Application error"),
        ("unhandled runtime error", "Unhandled Runtime Error"),
        ("typeerror", "TypeError"),
        ("referenceerror", "ReferenceError"),
        ("cannot read properties", "Cannot read properties"),
    ]:
        if pattern in body:
            errors.append(f"Page shows: '{label}'")
    if "404" in body and "this page could not be found" in body:
        errors.append("Page shows 404 Not Found")
    return errors


# ---- API Helpers ----

def api_get(api_url: str, endpoint: str, params=None) -> dict:
    """GET request to backend API."""
    url = f"{api_url}{endpoint}"
    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def api_post(api_url: str, endpoint: str, data=None) -> dict:
    """POST request to backend API."""
    url = f"{api_url}{endpoint}"
    resp = requests.post(url, json=data, headers={"Content-Type": "application/json"}, timeout=60)
    resp.raise_for_status()
    return resp.json()


def api_patch(api_url: str, endpoint: str, data=None) -> dict:
    """PATCH request to backend API."""
    url = f"{api_url}{endpoint}"
    resp = requests.patch(url, json=data, headers={"Content-Type": "application/json"}, timeout=60)
    resp.raise_for_status()
    return resp.json()


def api_put(api_url: str, endpoint: str, data=None) -> dict:
    """PUT request to backend API."""
    url = f"{api_url}{endpoint}"
    resp = requests.put(url, json=data, headers={"Content-Type": "application/json"}, timeout=60)
    resp.raise_for_status()
    return resp.json()


def api_delete(api_url: str, endpoint: str) -> requests.Response:
    """DELETE request to backend API."""
    url = f"{api_url}{endpoint}"
    resp = requests.delete(url, timeout=30)
    return resp


def wait_for_job(api_url: str, job_id: str, timeout=300, poll_interval=5) -> dict:
    """
    Poll a background job until it completes or fails.
    Returns the job result dict.
    """
    start = time.time()
    while time.time() - start < timeout:
        try:
            job = api_get(api_url, f"/api/v1/jobs/{job_id}")
            status = job.get("status", "")
            if status == "completed":
                return job
            elif status == "failed":
                raise Exception(f"Job {job_id} failed: {job.get('error', 'unknown')}")
            elif status == "cancelled":
                raise Exception(f"Job {job_id} was cancelled")
        except requests.exceptions.HTTPError:
            pass
        time.sleep(poll_interval)
    raise TimeoutError(f"Job {job_id} did not complete within {timeout}s")
