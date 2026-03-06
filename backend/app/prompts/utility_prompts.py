"""
Prompt constants for utility domain.
Auto-generated from YAML files in backend/app/prompts/utility/
"""

# ---------------------------------------------------------------------------
# utility/markdown_formatter.yaml
# ---------------------------------------------------------------------------

MARKDOWN_FORMATTER_SYSTEM = """"""

MARKDOWN_FORMATTER_USER = """Convert the following text to well-structured Markdown format.

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
{{ text }}

Return ONLY the Markdown-formatted text, no explanations.
"""

# ---------------------------------------------------------------------------
# PROMPTS registry
# ---------------------------------------------------------------------------

PROMPTS = {
    "utility/markdown_formatter": {
        "system": MARKDOWN_FORMATTER_SYSTEM,
        "user": MARKDOWN_FORMATTER_USER,
        "usage_type": "interview",
    },
}
