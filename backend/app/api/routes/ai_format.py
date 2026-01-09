"""
AI Format Routes
Endpoints for AI-powered text formatting
"""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models.ai_model import AIModel, AIModelUsageType
from app.services.ai_orchestrator import AIOrchestrator

router = APIRouter()


class FormatMarkdownRequest(BaseModel):
    """Request model for formatting text to Markdown"""
    text: str


class FormatMarkdownResponse(BaseModel):
    """Response model for formatted Markdown"""
    markdown: str


@router.post("/format-markdown", response_model=FormatMarkdownResponse)
async def format_to_markdown(
    request: FormatMarkdownRequest,
    db: Session = Depends(get_db)
):
    """
    Format plain text to Markdown using AI

    Uses the AI model configured for interviews to format text.
    The AI will analyze the text structure and convert it to proper Markdown format:
    - Headings
    - Lists (ordered and unordered)
    - Paragraphs
    - Emphasis (bold, italic)
    - Code blocks if detected
    """
    try:
        # Get AI model configured for interviews
        ai_model = db.query(AIModel).filter(
            AIModel.usage_type == AIModelUsageType.INTERVIEW,
            AIModel.is_active == True
        ).first()

        if not ai_model:
            # Fallback to simple formatting if no AI model configured
            return FormatMarkdownResponse(
                markdown=simple_format_to_markdown(request.text)
            )

        # Use AI Orchestrator to format the text
        orchestrator = AIOrchestrator(db)

        prompt = f"""Convert the following text to well-structured Markdown format.

Guidelines:
- Use # for main title (if identifiable)
- Use ## for section headers
- Use ### for subsections
- Convert numbered items to proper Markdown lists (1. 2. 3.)
- Convert bullet points to Markdown lists (-)
- Add emphasis (**bold**, *italic*) where appropriate
- Maintain paragraph breaks
- Keep the original meaning and content
- Do NOT add extra content, only format what's there

Text to format:
{request.text}

Return ONLY the Markdown-formatted text, no explanations."""

        # Execute AI request
        response = await orchestrator.execute(
            usage_type=AIModelUsageType.INTERVIEW,
            messages=[{
                "role": "user",
                "content": prompt
            }],
            max_tokens=2000
        )

        if response and response.get("content"):
            markdown_text = response["content"].strip()
            return FormatMarkdownResponse(markdown=markdown_text)
        else:
            # Fallback to simple formatting
            return FormatMarkdownResponse(
                markdown=simple_format_to_markdown(request.text)
            )

    except Exception as e:
        print(f"Error formatting to Markdown with AI: {e}")

        # Fallback to simple formatting
        return FormatMarkdownResponse(
            markdown=simple_format_to_markdown(request.text)
        )


def simple_format_to_markdown(text: str) -> str:
    """
    Simple fallback formatting when AI is unavailable
    Uses basic heuristics
    """
    lines = text.split('\n')
    formatted_lines = []

    for i, line in enumerate(lines):
        stripped = line.strip()

        if not stripped:
            formatted_lines.append('')
            continue

        # First non-empty line might be title
        if i == 0 and len(stripped) < 100:
            formatted_lines.append(f"# {stripped}")
            continue

        # Lines ending with : might be headers
        if stripped.endswith(':') and len(stripped) < 80:
            formatted_lines.append(f"## {stripped[:-1]}")
            continue

        # Numbered items
        if stripped[:1].isdigit() and (stripped[1:2] == ')' or stripped[1:2] == '.'):
            # Already numbered
            if stripped[1:2] == ')':
                formatted_lines.append(stripped.replace(')', '.', 1))
            else:
                formatted_lines.append(stripped)
            continue

        # Bullet points
        if stripped.startswith(('-', '•', '*')) and len(stripped) > 2:
            if not stripped.startswith('- '):
                formatted_lines.append(f"- {stripped[1:].lstrip()}")
            else:
                formatted_lines.append(stripped)
            continue

        # Regular paragraph
        formatted_lines.append(stripped)

    return '\n'.join(formatted_lines)
