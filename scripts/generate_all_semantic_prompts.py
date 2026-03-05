#!/usr/bin/env python3
"""
Generate rich semantic prompts for all ORBIT project cards.
Uses the /generate-semantic-prompt endpoint (wiki + rules + hierarchy).
Processes in batches of 5 concurrent jobs, polls until done.
"""
import psycopg2
import requests
import time
import sys

DB = "dbname=orbit user=orbit password=orbit_password host=localhost"
PROJECT_ID = "7cc16429-1a4e-44a1-873c-dfa0368625c8"
API_BASE = "http://localhost:8000"
BATCH_SIZE = 3
POLL_INTERVAL = 5   # seconds between polls
JOB_TIMEOUT = 360   # seconds max wait per job


def get_job_status(job_id: str) -> dict:
    try:
        r = requests.get(f"{API_BASE}/api/v1/jobs/{job_id}", timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        return {"status": "error", "error": str(e)}


def trigger_prompt(card_id: str) -> str | None:
    try:
        r = requests.post(
            f"{API_BASE}/api/v1/tasks/{card_id}/generate-semantic-prompt",
            json={"force": True},
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("job_id")
    except Exception as e:
        print(f"    ✗ Failed to trigger {card_id}: {e}")
        return None


def wait_for_jobs(jobs: list[tuple[str, str, str]]) -> tuple[int, int]:
    """Wait for a batch of (job_id, card_id, title) to complete. Returns (ok, fail)."""
    pending = {job_id: (card_id, title) for job_id, card_id, title in jobs}
    ok = fail = 0
    deadline = time.time() + JOB_TIMEOUT

    while pending and time.time() < deadline:
        time.sleep(POLL_INTERVAL)
        done = []
        for job_id in list(pending):
            status_data = get_job_status(job_id)
            status = status_data.get("status", "")
            if status == "completed":
                _, title = pending[job_id]
                print(f"    ✓ {title[:60]}")
                done.append(job_id)
                ok += 1
            elif status in ("failed", "error"):
                _, title = pending[job_id]
                err = status_data.get("error_message") or status_data.get("error", "")
                print(f"    ✗ {title[:60]} — {err[:80]}")
                done.append(job_id)
                fail += 1
        for job_id in done:
            del pending[job_id]

    # Anything still pending after timeout
    for job_id, (card_id, title) in pending.items():
        print(f"    ⏱ TIMEOUT: {title[:60]}")
        fail += 1

    return ok, fail


def main():
    conn = psycopg2.connect(DB)
    cur = conn.cursor()

    cur.execute("""
        SELECT id, item_type, title
        FROM tasks
        WHERE project_id = %s
        ORDER BY
            CASE item_type WHEN 'epic' THEN 1 WHEN 'story' THEN 2 ELSE 3 END,
            title
    """, (PROJECT_ID,))
    cards = cur.fetchall()
    cur.close()
    conn.close()

    total = len(cards)
    print(f"Cards to process: {total}")
    print(f"Batch size: {BATCH_SIZE} concurrent jobs\n")

    done_ok = done_fail = 0
    batches = [cards[i:i+BATCH_SIZE] for i in range(0, total, BATCH_SIZE)]

    for b_idx, batch in enumerate(batches):
        print(f"── Batch {b_idx+1}/{len(batches)} ──")
        jobs = []
        for card_id, item_type, title in batch:
            print(f"  → {item_type:6s} {title[:55]}")
            job_id = trigger_prompt(str(card_id))
            if job_id:
                jobs.append((job_id, str(card_id), title))
            else:
                done_fail += 1

        if jobs:
            ok, fail = wait_for_jobs(jobs)
            done_ok += ok
            done_fail += fail

        print(f"  Progress: {done_ok+done_fail}/{total} ({done_ok} ok, {done_fail} fail)\n")

    print("=" * 50)
    print(f"DONE: {done_ok}/{total} prompts generated ({done_fail} failed)")
    print("=" * 50)

    if done_fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
