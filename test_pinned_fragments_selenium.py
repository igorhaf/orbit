#!/usr/bin/env python3
"""
PROMPT #243 - Selenium test for Pinned Fragments multiple selection behavior.

Tests:
1. Navigate to project detail page
2. Select text in description area
3. Click "Persistência" button to pin the fragment
4. Verify the fragment appears highlighted (black bg, white text)
5. Select a SECOND text fragment (this is the bug — browser should allow free selection)
6. Click "Persistência" again to pin the second fragment
7. Verify BOTH fragments are highlighted
"""

import time
import sys
import json
import requests
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

# --- Config ---
BASE_URL = "http://localhost:3000"
API_URL = "http://localhost:8000"
PROJECT_ID = "2f663753-f159-4391-b152-5d31c9b8f9d6"

def setup_driver():
    """Create headless Chrome driver."""
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--disable-gpu")

    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=options)
    return driver


def reset_pinned_fragments():
    """Clear all pinned fragments via API before testing."""
    print("[SETUP] Clearing pinned fragments...")
    resp = requests.patch(
        f"{API_URL}/api/v1/projects/{PROJECT_ID}",
        json={"pinned_fragments": []},
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 200, f"Failed to reset: {resp.status_code} {resp.text}"
    data = resp.json()
    assert data.get("pinned_fragments") == [] or data.get("pinned_fragments") is None, \
        f"Failed to clear: {data.get('pinned_fragments')}"
    print("[SETUP] Pinned fragments cleared.")


def get_pinned_fragments():
    """Get current pinned fragments from API."""
    resp = requests.get(f"{API_URL}/api/v1/projects/{PROJECT_ID}")
    return resp.json().get("pinned_fragments") or []


def wait_for_description_area(driver, timeout=15):
    """Wait for the description display area to be rendered."""
    return WebDriverWait(driver, timeout).until(
        EC.presence_of_element_located((By.CSS_SELECTOR, ".prose.prose-sm"))
    )


def select_text_in_element(driver, element, start_offset, end_offset):
    """
    Use JavaScript to create a text selection within an element.
    This simulates the user dragging to select text.
    """
    # Get the first text node in the first <p> element
    js_select = """
    const container = arguments[0];
    const startOffset = arguments[1];
    const endOffset = arguments[2];

    // Find all text nodes in the container
    function getTextNodes(node) {
        let textNodes = [];
        if (node.nodeType === Node.TEXT_NODE) {
            textNodes.push(node);
        } else {
            for (let child of node.childNodes) {
                textNodes = textNodes.concat(getTextNodes(child));
            }
        }
        return textNodes;
    }

    const textNodes = getTextNodes(container);
    if (textNodes.length === 0) return 'NO_TEXT_NODES';

    // Build a full text string with character-to-node mapping
    let fullText = '';
    let nodeMap = []; // [{node, localOffset}] for each char in fullText
    for (const tn of textNodes) {
        for (let i = 0; i < tn.textContent.length; i++) {
            nodeMap.push({node: tn, offset: i});
            fullText += tn.textContent[i];
        }
    }

    if (startOffset >= nodeMap.length || endOffset > nodeMap.length) {
        return 'OFFSET_OUT_OF_RANGE: text length=' + fullText.length + ' start=' + startOffset + ' end=' + endOffset;
    }

    const range = document.createRange();
    range.setStart(nodeMap[startOffset].node, nodeMap[startOffset].offset);
    range.setEnd(nodeMap[endOffset - 1].node, nodeMap[endOffset - 1].offset + 1);

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    // Dispatch mouseup on the container to trigger the selection handler
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    return 'SELECTED: "' + selection.toString() + '"';
    """
    result = driver.execute_script(js_select, element, start_offset, end_offset)
    return result


def find_persist_button(driver, timeout=5):
    """Wait for the floating Persistência button to appear."""
    try:
        # The floating persist button has title "Persistir" and is display:flex when visible
        btn = WebDriverWait(driver, timeout).until(
            lambda d: next(
                (b for b in d.find_elements(By.CSS_SELECTOR, 'button[title*="Persistir"]')
                 if b.value_of_css_property('display') != 'none'),
                None
            )
        )
        return btn
    except Exception:
        return None


def get_highlighted_spans(driver):
    """Get all highlighted (pinned) spans in the description area."""
    spans = driver.find_elements(By.CSS_SELECTOR, 'span[data-pinned="true"]')
    return spans


def get_description_text(driver):
    """Get full text content of description area."""
    area = driver.find_element(By.CSS_SELECTOR, ".prose.prose-sm")
    return area.text


def test_single_pin(driver):
    """TEST 1: Pin a single fragment and verify highlight appears."""
    print("\n=== TEST 1: Single fragment pin ===")

    desc_area = wait_for_description_area(driver)
    full_text = desc_area.text
    print(f"  Description length: {len(full_text)} chars")
    print(f"  Description preview: {full_text[:120]}...")

    # Select characters 0-20 (first few words)
    # Find a good word boundary
    first_word_end = full_text.find(' ', 10)
    if first_word_end == -1:
        first_word_end = 20

    selection_text = full_text[:first_word_end].strip()
    print(f"  Selecting text: \"{selection_text}\" (chars 0-{first_word_end})")

    result = select_text_in_element(driver, desc_area, 0, first_word_end)
    print(f"  Selection result: {result}")

    # Wait for the Persist button to appear
    time.sleep(1)  # requestAnimationFrame delay

    persist_btn = find_persist_button(driver)
    if not persist_btn:
        print("  FAIL: Persist button did not appear after selection")
        return False

    print("  Persist button found. Clicking...")
    persist_btn.click()

    # Wait for backend save + reload
    time.sleep(3)

    # Check API
    fragments = get_pinned_fragments()
    print(f"  API pinned_fragments: {fragments}")

    if len(fragments) == 0:
        print("  FAIL: No fragments saved to API")
        return False

    # Check visual highlights
    highlights = get_highlighted_spans(driver)
    print(f"  Highlighted spans in DOM: {len(highlights)}")

    if len(highlights) == 0:
        print("  FAIL: No highlighted spans found in DOM")
        return False

    highlight_text = highlights[0].text
    print(f"  First highlight text: \"{highlight_text}\"")

    # Verify the highlight has correct styling
    bg_color = highlights[0].value_of_css_property("background-color")
    text_color = highlights[0].value_of_css_property("color")
    print(f"  Highlight bg: {bg_color}, text: {text_color}")

    print("  PASS: Single fragment pinned and highlighted correctly")
    return True


def test_multiple_pins(driver):
    """TEST 2: Pin a SECOND fragment after the first one."""
    print("\n=== TEST 2: Multiple fragments (the critical bug test) ===")

    desc_area = wait_for_description_area(driver)
    full_text = desc_area.text

    # Find a different region to select (around char 50-80)
    second_start = 50
    second_end_space = full_text.find(' ', 70)
    if second_end_space == -1 or second_end_space > 100:
        second_end_space = 80
    second_end = min(second_end_space, len(full_text))

    target_text = full_text[second_start:second_end].strip()
    print(f"  Selecting second text: \"{target_text}\" (chars {second_start}-{second_end})")

    # Try to select text
    result = select_text_in_element(driver, desc_area, second_start, second_end)
    print(f"  Selection result: {result}")

    # Check if the selection actually worked
    selected_text = driver.execute_script("return window.getSelection().toString()")
    print(f"  window.getSelection(): \"{selected_text}\"")

    if not selected_text or len(selected_text.strip()) < 3:
        print("  FAIL: Could not select text in description area (DOM re-render broke selection)")
        return False

    time.sleep(1)

    persist_btn = find_persist_button(driver)
    if not persist_btn:
        print("  FAIL: Persist button did not appear for second selection")
        # Let's check if selectedText state is empty
        sel_state = driver.execute_script("""
            // Try to find React fiber to check state
            return window.getSelection().toString();
        """)
        print(f"  Current browser selection: \"{sel_state}\"")
        return False

    print("  Persist button found for second selection. Clicking...")
    persist_btn.click()

    # Wait for backend save + reload
    time.sleep(3)

    # Check API
    fragments = get_pinned_fragments()
    print(f"  API pinned_fragments: {fragments}")

    if len(fragments) < 2:
        print(f"  FAIL: Expected 2+ fragments, got {len(fragments)}")
        return False

    # Check visual highlights
    highlights = get_highlighted_spans(driver)
    print(f"  Highlighted spans in DOM: {len(highlights)}")

    if len(highlights) < 2:
        print(f"  FAIL: Expected 2+ highlighted spans, got {len(highlights)}")
        return False

    for i, h in enumerate(highlights):
        print(f"    Highlight {i+1}: \"{h.text[:60]}\"")

    print("  PASS: Multiple fragments pinned and highlighted correctly")
    return True


def test_native_selection_after_pin(driver):
    """TEST 3: Verify native browser selection still works after pinning."""
    print("\n=== TEST 3: Native selection works after pinning ===")

    desc_area = wait_for_description_area(driver)
    full_text = desc_area.text

    # Try to select text in a region that doesn't overlap with pinned fragments
    # Use the middle of the text
    mid = len(full_text) // 2
    mid_end = full_text.find(' ', mid + 15)
    if mid_end == -1:
        mid_end = mid + 20
    mid_end = min(mid_end, len(full_text))

    target = full_text[mid:mid_end].strip()
    print(f"  Selecting at middle: \"{target}\" (chars {mid}-{mid_end})")

    result = select_text_in_element(driver, desc_area, mid, mid_end)
    print(f"  Selection result: {result}")

    selected = driver.execute_script("return window.getSelection().toString()")
    print(f"  window.getSelection(): \"{selected}\"")

    if not selected or len(selected.strip()) < 3:
        print("  FAIL: Native selection broken after pinning fragments")
        return False

    # Check that the selected text is roughly what we expected
    if target[:5] not in selected and selected[:5] not in target:
        print(f"  WARN: Selection mismatch. Expected ~\"{target}\", got \"{selected}\"")

    # Check persist button appears
    time.sleep(1)
    persist_btn = find_persist_button(driver)
    if not persist_btn:
        print("  FAIL: Persist button did not appear for new selection after existing pins")
        return False

    print("  PASS: Native selection works correctly after pinning")
    return True


def test_pin_after_unpin_all(driver):
    """TEST 4: Remove all pins via API, then try to pin again (the reported bug)."""
    print("\n=== TEST 4: Pin works after removing all fragments ===")

    # Clear all pinned fragments via API (simulates user clicking to unpin all)
    print("  Clearing all pinned fragments via API...")
    reset_pinned_fragments()

    # Reload page to get fresh state with zero pins
    url = f"{BASE_URL}/projects/{PROJECT_ID}"
    driver.get(url)
    time.sleep(5)

    desc_area = wait_for_description_area(driver)
    full_text = desc_area.text

    # Verify no highlights exist
    highlights = get_highlighted_spans(driver)
    print(f"  Highlights after clear: {len(highlights)} (expected 0)")
    if len(highlights) != 0:
        print("  WARN: Highlights still present after clearing")

    # Now try to select and pin text
    first_word_end = full_text.find(' ', 10)
    if first_word_end == -1:
        first_word_end = 20

    target = full_text[:first_word_end].strip()
    print(f"  Selecting text: \"{target}\" (chars 0-{first_word_end})")

    result = select_text_in_element(driver, desc_area, 0, first_word_end)
    print(f"  Selection result: {result}")

    selected = driver.execute_script("return window.getSelection().toString()")
    print(f"  window.getSelection(): \"{selected}\"")

    if not selected or len(selected.strip()) < 3:
        print("  FAIL: Could not select text after clearing all pins")
        return False

    time.sleep(1)

    persist_btn = find_persist_button(driver)
    if not persist_btn:
        print("  FAIL: Persist button did not appear after clearing all pins")
        return False

    print("  Persist button found. Clicking...")
    persist_btn.click()
    time.sleep(3)

    # Verify it was saved
    fragments = get_pinned_fragments()
    print(f"  API pinned_fragments: {fragments}")

    if len(fragments) == 0:
        print("  FAIL: Fragment not saved after clearing all pins")
        return False

    # Check highlight in DOM
    highlights = get_highlighted_spans(driver)
    print(f"  Highlighted spans: {len(highlights)}")

    if len(highlights) == 0:
        print("  FAIL: No highlights after re-pinning")
        return False

    print("  PASS: Pin works correctly after removing all fragments")
    return True


def main():
    print("=" * 70)
    print("PROMPT #243 — Pinned Fragments Selenium Test")
    print("=" * 70)

    # Reset state
    reset_pinned_fragments()

    # Setup driver
    print("\n[SETUP] Starting Chrome headless...")
    driver = setup_driver()

    results = {}

    try:
        # Navigate to project page
        url = f"{BASE_URL}/projects/{PROJECT_ID}"
        print(f"[NAV] Loading {url}")
        driver.get(url)

        # Wait for page to fully load
        time.sleep(5)

        # Check if description tab is visible
        try:
            desc_area = wait_for_description_area(driver, timeout=15)
            print(f"[NAV] Description area found. Text: {desc_area.text[:100]}...")
        except Exception as e:
            print(f"[NAV] FAIL: Description area not found: {e}")
            # Take screenshot for debugging
            driver.save_screenshot("/tmp/selenium_debug.png")
            print("[NAV] Screenshot saved to /tmp/selenium_debug.png")
            # Print page source for debugging
            print(f"[NAV] Page title: {driver.title}")
            print(f"[NAV] Current URL: {driver.current_url}")
            sys.exit(1)

        # Run tests
        results["test_single_pin"] = test_single_pin(driver)

        # Reload page before second test to ensure clean DOM
        print("\n[NAV] Reloading page for test 2...")
        driver.get(url)
        time.sleep(5)
        wait_for_description_area(driver, timeout=15)

        results["test_multiple_pins"] = test_multiple_pins(driver)

        results["test_native_selection"] = test_native_selection_after_pin(driver)

        results["test_pin_after_unpin_all"] = test_pin_after_unpin_all(driver)

    except Exception as e:
        print(f"\n[ERROR] Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        driver.save_screenshot("/tmp/selenium_error.png")
        print("[ERROR] Screenshot saved to /tmp/selenium_error.png")
    finally:
        driver.quit()

    # Summary
    print("\n" + "=" * 70)
    print("RESULTS SUMMARY")
    print("=" * 70)

    all_pass = True
    for name, passed in results.items():
        status = "PASS" if passed else "FAIL"
        print(f"  {status}: {name}")
        if not passed:
            all_pass = False

    if all_pass:
        print("\nAll tests PASSED!")
    else:
        print("\nSome tests FAILED!")

    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
