"""
Git Commits API Router
PROMPT #113 - Git Integration: List commits from project's code_path

Provides endpoints to read Git commit history from project repositories.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel
from datetime import datetime
import subprocess
import os
import logging

from app.database import get_db
from app.models.project import Project

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# RESPONSE MODELS
# ============================================================================

class GitCommit(BaseModel):
    """Model for a Git commit."""
    hash: str
    short_hash: str
    author_name: str
    author_email: str
    date: datetime
    relative_date: str
    subject: str
    body: Optional[str] = None
    files_changed: Optional[int] = None
    insertions: Optional[int] = None
    deletions: Optional[int] = None

    class Config:
        from_attributes = True


class GitCommitsResponse(BaseModel):
    """Response model for Git commits list."""
    commits: List[GitCommit]
    total: int
    branch: str
    has_more: bool


class GitBranch(BaseModel):
    """Model for a Git branch."""
    name: str
    is_current: bool
    last_commit_hash: Optional[str] = None
    last_commit_date: Optional[datetime] = None


class GitBranchesResponse(BaseModel):
    """Response model for Git branches list."""
    branches: List[GitBranch]
    current: str


class GitRepoInfo(BaseModel):
    """Model for Git repository info."""
    is_git_repo: bool
    path: str
    current_branch: Optional[str] = None
    total_commits: Optional[int] = None
    remote_url: Optional[str] = None
    has_uncommitted_changes: Optional[bool] = None


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def run_git_command(code_path: str, args: List[str]) -> tuple[bool, str]:
    """
    Run a git command in the specified directory.
    Returns (success, output).
    """
    try:
        result = subprocess.run(
            ["git"] + args,
            cwd=code_path,
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode == 0:
            return True, result.stdout.strip()
        else:
            return False, result.stderr.strip()
    except subprocess.TimeoutExpired:
        return False, "Git command timed out"
    except Exception as e:
        return False, str(e)


def is_git_repository(code_path: str) -> bool:
    """Check if the path is a Git repository."""
    git_dir = os.path.join(code_path, ".git")
    return os.path.isdir(git_dir)


def parse_commit_log(log_output: str) -> List[GitCommit]:
    """
    Parse git log output with custom format.
    Format: hash|short_hash|author_name|author_email|date|relative_date|subject
    """
    commits = []
    if not log_output:
        return commits

    for line in log_output.split("\n"):
        if not line.strip():
            continue

        parts = line.split("|", 6)
        if len(parts) < 7:
            continue

        try:
            commit = GitCommit(
                hash=parts[0],
                short_hash=parts[1],
                author_name=parts[2],
                author_email=parts[3],
                date=datetime.fromisoformat(parts[4].replace("Z", "+00:00")),
                relative_date=parts[5],
                subject=parts[6],
                body=None
            )
            commits.append(commit)
        except Exception as e:
            logger.warning(f"Failed to parse commit line: {line}, error: {e}")
            continue

    return commits


# ============================================================================
# ENDPOINTS
# ============================================================================

@router.get("/projects/{project_id}/git/commits", response_model=GitCommitsResponse)
async def list_git_commits(
    project_id: UUID,
    skip: int = Query(0, ge=0, description="Number of commits to skip"),
    limit: int = Query(50, ge=1, le=200, description="Maximum number of commits to return"),
    branch: Optional[str] = Query(None, description="Branch name (defaults to current branch)"),
    author: Optional[str] = Query(None, description="Filter by author name or email"),
    since: Optional[str] = Query(None, description="Show commits since date (e.g., '2024-01-01' or '1 week ago')"),
    until: Optional[str] = Query(None, description="Show commits until date"),
    search: Optional[str] = Query(None, description="Search in commit messages"),
    db: Session = Depends(get_db)
):
    """
    List Git commits from the project's code_path.

    - **project_id**: UUID of the project
    - **skip**: Number of commits to skip (for pagination)
    - **limit**: Maximum number of commits to return
    - **branch**: Branch name to list commits from (defaults to current)
    - **author**: Filter by author name or email
    - **since**: Filter commits after this date
    - **until**: Filter commits before this date
    - **search**: Search term in commit messages
    """
    # Get project
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    if not project.code_path:
        raise HTTPException(status_code=400, detail="Project has no code_path configured")

    if not os.path.isdir(project.code_path):
        raise HTTPException(status_code=400, detail=f"Code path does not exist: {project.code_path}")

    if not is_git_repository(project.code_path):
        raise HTTPException(status_code=400, detail=f"Code path is not a Git repository: {project.code_path}")

    # Build git log command
    # Format: hash|short_hash|author_name|author_email|date|relative_date|subject
    format_str = "%H|%h|%an|%ae|%aI|%ar|%s"

    git_args = [
        "log",
        f"--format={format_str}",
        f"--skip={skip}",
        f"--max-count={limit + 1}",  # +1 to check if there are more
    ]

    if branch:
        git_args.append(branch)

    if author:
        git_args.append(f"--author={author}")

    if since:
        git_args.append(f"--since={since}")

    if until:
        git_args.append(f"--until={until}")

    if search:
        git_args.append(f"--grep={search}")
        git_args.append("-i")  # case insensitive

    success, output = run_git_command(project.code_path, git_args)
    if not success:
        raise HTTPException(status_code=500, detail=f"Git command failed: {output}")

    commits = parse_commit_log(output)

    # Check if there are more commits
    has_more = len(commits) > limit
    if has_more:
        commits = commits[:limit]

    # Get current branch name
    success, current_branch = run_git_command(project.code_path, ["rev-parse", "--abbrev-ref", "HEAD"])
    if not success:
        current_branch = "unknown"

    # Get total commit count (for info, not for pagination)
    count_args = ["rev-list", "--count", "HEAD"]
    if branch:
        count_args[-1] = branch
    success, total_str = run_git_command(project.code_path, count_args)
    total = int(total_str) if success and total_str.isdigit() else len(commits)

    return GitCommitsResponse(
        commits=commits,
        total=total,
        branch=branch or current_branch,
        has_more=has_more
    )


@router.get("/projects/{project_id}/git/commits/{commit_hash}", response_model=GitCommit)
async def get_git_commit_detail(
    project_id: UUID,
    commit_hash: str,
    db: Session = Depends(get_db)
):
    """
    Get detailed information about a specific Git commit.

    - **project_id**: UUID of the project
    - **commit_hash**: Full or short hash of the commit
    """
    # Get project
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    if not project.code_path or not is_git_repository(project.code_path):
        raise HTTPException(status_code=400, detail="Project is not a Git repository")

    # Get commit details
    format_str = "%H|%h|%an|%ae|%aI|%ar|%s|%b"
    success, output = run_git_command(
        project.code_path,
        ["log", "-1", f"--format={format_str}", commit_hash]
    )

    if not success or not output:
        raise HTTPException(status_code=404, detail=f"Commit {commit_hash} not found")

    parts = output.split("|", 7)
    if len(parts) < 7:
        raise HTTPException(status_code=500, detail="Failed to parse commit details")

    # Get file stats
    success, stat_output = run_git_command(
        project.code_path,
        ["diff", "--shortstat", f"{commit_hash}^!", "--"]
    )

    files_changed = insertions = deletions = None
    if success and stat_output:
        # Parse: "3 files changed, 10 insertions(+), 5 deletions(-)"
        import re
        match = re.search(r"(\d+) files? changed", stat_output)
        if match:
            files_changed = int(match.group(1))
        match = re.search(r"(\d+) insertions?", stat_output)
        if match:
            insertions = int(match.group(1))
        match = re.search(r"(\d+) deletions?", stat_output)
        if match:
            deletions = int(match.group(1))

    return GitCommit(
        hash=parts[0],
        short_hash=parts[1],
        author_name=parts[2],
        author_email=parts[3],
        date=datetime.fromisoformat(parts[4].replace("Z", "+00:00")),
        relative_date=parts[5],
        subject=parts[6],
        body=parts[7] if len(parts) > 7 and parts[7].strip() else None,
        files_changed=files_changed,
        insertions=insertions,
        deletions=deletions
    )


@router.get("/projects/{project_id}/git/branches", response_model=GitBranchesResponse)
async def list_git_branches(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    List all Git branches in the project repository.

    - **project_id**: UUID of the project
    """
    # Get project
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    if not project.code_path or not is_git_repository(project.code_path):
        raise HTTPException(status_code=400, detail="Project is not a Git repository")

    # Get current branch
    success, current_branch = run_git_command(project.code_path, ["rev-parse", "--abbrev-ref", "HEAD"])
    if not success:
        current_branch = "main"

    # List all branches with their last commit
    success, output = run_git_command(
        project.code_path,
        ["branch", "-a", "--format=%(refname:short)|%(objectname:short)|%(committerdate:iso)"]
    )

    if not success:
        raise HTTPException(status_code=500, detail=f"Failed to list branches: {output}")

    branches = []
    for line in output.split("\n"):
        if not line.strip():
            continue

        parts = line.split("|")
        name = parts[0]

        # Skip HEAD references
        if "HEAD" in name:
            continue

        last_commit_hash = parts[1] if len(parts) > 1 else None
        last_commit_date = None
        if len(parts) > 2 and parts[2]:
            try:
                # Parse ISO date
                date_str = parts[2].strip()
                last_commit_date = datetime.fromisoformat(date_str.replace(" ", "T").split("+")[0])
            except:
                pass

        branches.append(GitBranch(
            name=name,
            is_current=(name == current_branch),
            last_commit_hash=last_commit_hash,
            last_commit_date=last_commit_date
        ))

    return GitBranchesResponse(
        branches=branches,
        current=current_branch
    )


@router.get("/projects/{project_id}/git/info", response_model=GitRepoInfo)
async def get_git_repo_info(
    project_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get Git repository information for a project.

    - **project_id**: UUID of the project
    """
    # Get project
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    if not project.code_path:
        return GitRepoInfo(
            is_git_repo=False,
            path="",
            current_branch=None,
            total_commits=None,
            remote_url=None,
            has_uncommitted_changes=None
        )

    if not os.path.isdir(project.code_path):
        return GitRepoInfo(
            is_git_repo=False,
            path=project.code_path,
            current_branch=None,
            total_commits=None,
            remote_url=None,
            has_uncommitted_changes=None
        )

    if not is_git_repository(project.code_path):
        return GitRepoInfo(
            is_git_repo=False,
            path=project.code_path,
            current_branch=None,
            total_commits=None,
            remote_url=None,
            has_uncommitted_changes=None
        )

    # Get current branch
    success, current_branch = run_git_command(project.code_path, ["rev-parse", "--abbrev-ref", "HEAD"])
    current_branch = current_branch if success else None

    # Get total commit count
    success, count_str = run_git_command(project.code_path, ["rev-list", "--count", "HEAD"])
    total_commits = int(count_str) if success and count_str.isdigit() else None

    # Get remote URL
    success, remote_url = run_git_command(project.code_path, ["remote", "get-url", "origin"])
    remote_url = remote_url if success else None

    # Check for uncommitted changes
    success, status_output = run_git_command(project.code_path, ["status", "--porcelain"])
    has_uncommitted_changes = bool(status_output) if success else None

    return GitRepoInfo(
        is_git_repo=True,
        path=project.code_path,
        current_branch=current_branch,
        total_commits=total_commits,
        remote_url=remote_url,
        has_uncommitted_changes=has_uncommitted_changes
    )
