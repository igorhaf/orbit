#!/usr/bin/env python3
"""
ORBIT Frontend Selenium Health Check
=====================================
Headless Chrome smoke test for all major pages and tabs.
Run: python3 scripts/selenium_health_check.py
"""

import sys
import time
import traceback
import re
from dataclasses import dataclass, field

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from webdriver_manager.chrome import ChromeDriverManager

BASE = "http://localhost:3000"
TIMEOUT = 12

# Console error patterns that are expected noise in headless mode
NOISE_PATTERNS = [
    "WebSocket error",
    "Job Queue WebSocket error",
    "webpack-internal://",
    "favicon.ico",
]


@dataclass
class CheckResult:
    page: str
    url: str
    loaded: bool = False
    content_ok: bool = False
    details: str = ""
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    elapsed: float = 0.0


def make_driver() -> webdriver.Chrome:
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1920,1080")
    opts.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    service = Service(ChromeDriverManager().install())
    return webdriver.Chrome(service=service, options=opts)


def collect_console_errors(driver) -> tuple[list[str], list[str]]:
    """Separate real errors from expected noise."""
    real, noise = [], []
    try:
        for entry in driver.get_log("browser"):
            if entry.get("level") != "SEVERE":
                continue
            msg = entry["message"]
            (noise if any(p in msg for p in NOISE_PATTERNS) else real).append(msg)
    except Exception:
        pass
    return real, noise


def wait_for_body(driver, timeout=TIMEOUT):
    WebDriverWait(driver, timeout).until(
        lambda d: len(d.find_element(By.TAG_NAME, "body").text.strip()) > 5
    )


def check_for_page_errors(driver) -> list[str]:
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


def check_page(driver, name, url, content_check=None) -> CheckResult:
    r = CheckResult(name, url)
    t0 = time.time()
    try:
        driver.get(url)
        time.sleep(1)
        wait_for_body(driver)
        r.loaded = True
        body = driver.find_element(By.TAG_NAME, "body").text
        r.errors = check_for_page_errors(driver)
        console_errs, console_noise = collect_console_errors(driver)
        r.errors.extend(console_errs)
        r.warnings.extend(console_noise)
        r.content_ok = len(body.strip()) > 30

        extra = content_check(body, driver) if content_check else ""
        snippet = body[:250].replace("\n", " | ")
        r.details = f"Body: {len(body)} chars"
        if extra:
            r.details += f"\n    {extra}"
        r.details += f"\n    Snippet: {snippet}"
    except Exception as e:
        r.errors.append(str(e))
    r.elapsed = time.time() - t0
    return r


def check_tab(driver, tab_button_text, expected_content=None) -> CheckResult:
    """Click a tab button on the current page and verify content changes."""
    r = CheckResult(f"Tab: {tab_button_text}", driver.current_url)
    t0 = time.time()
    try:
        # Find and click the tab button by exact text
        buttons = driver.find_elements(By.TAG_NAME, "button")
        clicked = False
        for btn in buttons:
            if btn.text.strip() == tab_button_text:
                btn.click()
                clicked = True
                time.sleep(1.5)
                break

        if not clicked:
            r.errors.append(f"Tab button '{tab_button_text}' not found")
            r.elapsed = time.time() - t0
            return r

        body = driver.find_element(By.TAG_NAME, "body").text
        r.loaded = True
        r.errors = check_for_page_errors(driver)
        console_errs, console_noise = collect_console_errors(driver)
        r.errors.extend(console_errs)
        r.warnings.extend(console_noise)
        r.content_ok = len(body.strip()) > 50

        # Specific content validation
        if expected_content:
            found = expected_content.lower() in body.lower()
            r.details = f"Expected '{expected_content}': {'found' if found else 'NOT FOUND'}"
            if not found:
                r.content_ok = False
        else:
            r.details = f"Body: {len(body)} chars"

        snippet = body[:250].replace("\n", " | ")
        r.details += f"\n    Snippet: {snippet}"
    except Exception as e:
        r.errors.append(str(e))
    r.elapsed = time.time() - t0
    return r


def find_meada_project_url(driver) -> str | None:
    driver.get(f"{BASE}/projects")
    time.sleep(2)
    wait_for_body(driver)
    html = driver.find_element(By.TAG_NAME, "body").get_attribute("innerHTML")
    html_lower = html.lower()
    project_hrefs = list(dict.fromkeys(re.findall(r'href="(/projects/[a-f0-9-]+)"', html)))
    for href in project_hrefs:
        idx = html_lower.find(href.lower())
        if idx == -1:
            continue
        start = max(0, idx - 1000)
        end = min(len(html_lower), idx + 1000)
        if "meada" in html_lower[start:end]:
            return f"{BASE}{href}"
    return None


def print_result(r: CheckResult):
    if r.loaded and r.content_ok and not r.errors:
        status = "PASS"
    elif not r.loaded:
        status = "FAIL"
    else:
        status = "WARN"
    print(f"\n  [{status}] {r.page}")
    print(f"    URL: {r.url}")
    print(f"    Loaded: {r.loaded} | Content OK: {r.content_ok} | Time: {r.elapsed:.1f}s")
    if r.details:
        for line in r.details.split("\n"):
            print(f"    {line.strip()}")
    if r.errors:
        for err in r.errors[:5]:
            print(f"    ERROR: {err}")
        if len(r.errors) > 5:
            print(f"    ... and {len(r.errors) - 5} more")
    if r.warnings:
        print(f"    (noise: {len(set(r.warnings))} WebSocket/webpack warnings - expected)")
    return status


def main():
    print("=" * 72)
    print("  ORBIT Frontend - Selenium Health Check")
    print("=" * 72)

    all_results: list[CheckResult] = []
    stats = {"PASS": 0, "WARN": 0, "FAIL": 0}
    driver = None

    try:
        print("\n  Initializing headless Chrome...", end="", flush=True)
        driver = make_driver()
        print(" OK\n")

        # ---- 1. HOME ----
        print("--- 1. Home Page ---")
        r = check_page(driver, "Home / Dashboard", f"{BASE}/",
                        lambda b, d: f"Has nav: {'projetos' in b.lower()}")
        all_results.append(r)
        stats[print_result(r)] += 1

        # ---- 2. PROJECTS LIST ----
        print("\n--- 2. Projects List ---")
        def proj_check(b, d):
            links = [l for l in d.find_elements(By.TAG_NAME, "a")
                     if l.get_attribute("href") and "/projects/" in l.get_attribute("href")]
            names = [k for k in ["meada", "orbit"] if k in b.lower()]
            return f"Project links: {len(links)} | Names found: {names}"
        r = check_page(driver, "Projects List", f"{BASE}/projects", proj_check)
        all_results.append(r)
        stats[print_result(r)] += 1

        # ---- 3. MEADA PROJECT ----
        print("\n--- 3. Meada Project Detail ---")
        meada_url = find_meada_project_url(driver)
        if meada_url:
            print(f"  Found Meada at: {meada_url}")
            r = check_page(driver, "Meada Project Detail", meada_url,
                           lambda b, d: f"Has description: {'meada digital' in b.lower()}")
            all_results.append(r)
            stats[print_result(r)] += 1
        else:
            r = CheckResult("Meada Project Detail", f"{BASE}/projects")
            r.errors.append("Could not find Meada project on /projects page")
            all_results.append(r)
            stats[print_result(r)] += 1

        # ---- 4. PROJECT TABS ----
        # Tabs are <button> elements, not URL routes. Click each and verify.
        if meada_url:
            print("\n--- 4. Project Tabs (button clicks) ---")

            # Navigate to project page fresh before tab checks
            driver.get(meada_url)
            time.sleep(2)
            wait_for_body(driver)
            # Clear any accumulated console logs
            collect_console_errors(driver)

            # The actual tab button labels (Portuguese)
            tab_tests = [
                ("Visão Geral", "Descrição do Projeto"),    # Overview
                ("Backlog", None),                            # Backlog
                ("Kanban", None),                             # Kanban
                ("Wiki", "Wiki"),                             # Wiki
                ("Especificações", None),                     # Specs
                ("Commits", None),                            # Commits
                ("RAG", None),                                # RAG
                ("Fila", None),                               # Queue
            ]

            for tab_label, expected in tab_tests:
                r = check_tab(driver, tab_label, expected)
                all_results.append(r)
                stats[print_result(r)] += 1
        else:
            print("\n--- SKIPPING Project Tabs (Meada not found) ---")

        # ---- 5. AI MODELS ----
        print("\n--- 5. AI Models ---")
        r = check_page(driver, "AI Models", f"{BASE}/ai-models",
                        lambda b, d: f"Keywords: {[k for k in ['anthropic','openai','gemini','ollama','claude','gpt'] if k in b.lower()]}")
        all_results.append(r)
        stats[print_result(r)] += 1

        # ---- 6. JOBS ----
        print("\n--- 6. Jobs ---")
        r = check_page(driver, "Jobs", f"{BASE}/jobs",
                        lambda b, d: f"Has queue UI: {'fila' in b.lower() or 'jobs' in b.lower()}")
        all_results.append(r)
        stats[print_result(r)] += 1

    except Exception as e:
        print(f"\n  FATAL ERROR: {e}")
        traceback.print_exc()
    finally:
        if driver:
            driver.quit()

    # ---- SUMMARY ----
    total = len(all_results)
    total_time = sum(r.elapsed for r in all_results)

    print("\n" + "=" * 72)
    print("  SUMMARY")
    print("=" * 72)
    print(f"\n  Total checks : {total}")
    print(f"  PASS         : {stats['PASS']}")
    print(f"  WARN         : {stats['WARN']}")
    print(f"  FAIL         : {stats['FAIL']}")
    print(f"  Total time   : {total_time:.1f}s")

    if stats["FAIL"] > 0:
        print("\n  FAILED pages:")
        for r in all_results:
            if not r.loaded:
                errs = "; ".join(r.errors[:2])
                print(f"    - {r.page}: {errs}")

    if stats["WARN"] > 0:
        print("\n  WARNINGS:")
        for r in all_results:
            if r.loaded and (not r.content_ok or r.errors):
                issues = "; ".join(r.errors[:2]) if r.errors else "content too short/missing"
                print(f"    - {r.page}: {issues}")

    if stats["PASS"] == total:
        print("\n  All checks passed!")

    print("\n" + "=" * 72)
    return 0 if stats["FAIL"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
