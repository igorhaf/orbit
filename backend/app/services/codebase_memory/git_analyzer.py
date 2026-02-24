"""
Git Analyzer Mixin for CodebaseMemoryService

Contains methods for extracting and analyzing git commit history
to identify business rules.

PROMPT #184 - Extract business rules from git commit history
"""

import logging
import subprocess
from pathlib import Path
from typing import Dict, List, Optional
from uuid import UUID

logger = logging.getLogger(__name__)

# PROMPT #184 - Git commit analysis for business rules
NOISE_COMMIT_PATTERNS = [
    "merge branch", "merge pull request", "merge remote",
    "bump version", "update deps", "chore(deps)",
    "initial commit", "wip", "fixup!", "squash!",
    "auto-generated", "generated with", "co-authored-by",
    "update changelog", "release v", "version bump",
]


class GitAnalyzerMixin:
    """Mixin providing git commit extraction and analysis."""

    NOISE_COMMIT_PATTERNS = NOISE_COMMIT_PATTERNS

    def _is_noise_commit(self, subject: str) -> bool:
        """Return True for commits unlikely to contain business rules."""
        subject_lower = subject.lower().strip()
        if not subject_lower or len(subject_lower) < 5:
            return True
        return any(pattern in subject_lower for pattern in self.NOISE_COMMIT_PATTERNS)

    def _extract_git_commits(self, root_path: Path, max_commits: int = 200) -> List[Dict[str, str]]:
        """
        Extract recent git commits from repository.

        PROMPT #184 - Uses subprocess to run git log.
        Returns empty list if no .git directory or git not available.
        """
        git_dir = root_path / ".git"
        if not git_dir.exists():
            logger.info("📝 No .git directory found, skipping commit analysis")
            return []

        try:
            result = subprocess.run(
                ["git", "log", f"--pretty=format:%H|||%s|||%b|||%an|||%ad",
                 "--date=short", f"-{max_commits}"],
                cwd=str(root_path),
                capture_output=True, text=True, timeout=30
            )
            if result.returncode != 0:
                logger.warning(f"git log failed: {result.stderr[:200]}")
                return []

            commits = []
            for line in result.stdout.strip().split("\n"):
                if not line.strip():
                    continue
                parts = line.split("|||")
                if len(parts) >= 2:
                    subject = parts[1].strip()
                    if self._is_noise_commit(subject):
                        continue
                    commits.append({
                        "hash": parts[0].strip()[:12],
                        "subject": subject,
                        "body": parts[2].strip() if len(parts) > 2 else "",
                        "author": parts[3].strip() if len(parts) > 3 else "",
                        "date": parts[4].strip() if len(parts) > 4 else ""
                    })

            logger.info(f"📝 Extracted {len(commits)} meaningful commits (filtered from {max_commits} max)")
            return commits

        except subprocess.TimeoutExpired:
            logger.warning("git log timed out after 30s")
            return []
        except FileNotFoundError:
            logger.warning("git command not found")
            return []
        except Exception as e:
            logger.warning(f"Failed to extract git commits: {e}")
            return []

    def _format_commits_for_prompt(self, commits: List[Dict[str, str]]) -> str:
        """Format commits into readable text for AI prompt."""
        parts = []
        for c in commits:
            entry = f"[{c['date']}] {c['hash']} - {c['subject']}"
            if c.get("body"):
                body_clean = c["body"].replace("\n", " ").strip()[:200]
                if body_clean:
                    entry += f"\n  {body_clean}"
            parts.append(entry)
        return "\n".join(parts)

    async def _analyze_git_commits(
        self,
        commits: List[Dict[str, str]],
        stack_info: Dict,
        project_id: Optional[UUID] = None
    ) -> List[str]:
        """
        Use AI to extract business rules from git commit messages.

        PROMPT #184 - Follows same pattern as _analyze_phase().
        """
        if not commits:
            return []

        commit_text = self._format_commits_for_prompt(commits)

        try:
            from app.contracts.loader import ContractLoader
            loader = ContractLoader()

            system_prompt, user_prompt = loader.render(
                "memory/git_commit_analysis",
                {
                    "folder_name": self.current_folder_name,
                    "commit_log": commit_text,
                    "total_commits": len(commits),
                    "stack_detected": stack_info.get("detected_stack", "")
                }
            )

            response = await self.orchestrator.execute(
                usage_type="memory",
                messages=[{"role": "user", "content": user_prompt}],
                system_prompt=system_prompt,
                project_id=project_id,
                metadata={
                    "phase": "git_commit_analysis",
                    "commits_count": len(commits),
                    "scan_type": "memory_scan_git_commits",
                    "scan_depth": self.current_scan_depth
                }
            )

            result = self._parse_phase_response(response.get("content", "{}"))
            rules = result.get("business_rules_found", [])
            logger.info(f"📝 AI extracted {len(rules)} business rules from git commits")
            return rules

        except Exception as e:
            logger.warning(f"Git commit AI analysis failed: {e}")
            return []
