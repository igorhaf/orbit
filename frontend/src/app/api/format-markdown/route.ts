/**
 * API Route: Format text to Markdown using AI
 * POST /api/format-markdown
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  // Read body once at the beginning
  let text: string;

  try {
    const body = await request.json();
    text = body.text;
  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  if (!text) {
    return NextResponse.json(
      { error: 'Text is required' },
      { status: 400 }
    );
  }

  try {
    // Call backend AI service to format text to Markdown
    // Use Docker service name for server-side calls, fallback to localhost
    const backendUrl = process.env.BACKEND_URL || 'http://backend:8000';

    const response = await fetch(`${backendUrl}/api/v1/ai/format-markdown`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const data = await response.json();

    return NextResponse.json({
      markdown: data.markdown,
    });
  } catch (error) {
    console.error('Error formatting to Markdown:', error);

    // Fallback: simple formatting rules (text already extracted above)
    const fallbackMarkdown = autoFormatToMarkdown(text);

    return NextResponse.json({
      markdown: fallbackMarkdown,
    });
  }
}

/**
 * Fallback function to auto-format text to Markdown
 * Uses simple heuristics when AI is unavailable
 */
function autoFormatToMarkdown(text: string): string {
  let formatted = text;

  // Split into paragraphs
  const paragraphs = formatted.split(/\n\n+/);

  formatted = paragraphs
    .map((para, index) => {
      // First paragraph might be a title
      if (index === 0 && para.length < 100 && !para.includes('\n')) {
        return `# ${para}`;
      }

      // Detect numbered items (1), 2), etc.)
      if (/^\d+\)/.test(para)) {
        const lines = para.split('\n');
        return lines
          .map(line => {
            if (/^\d+\)\s*/.test(line)) {
              return line.replace(/^(\d+)\)\s*/, '$1. ');
            }
            return line;
          })
          .join('\n');
      }

      // Detect bullet points or dashes
      if (/^[-•]\s/.test(para)) {
        const lines = para.split('\n');
        return lines
          .map(line => {
            if (/^[-•]\s/.test(line)) {
              return line.replace(/^[-•]\s/, '- ');
            }
            return line;
          })
          .join('\n');
      }

      // Detect section headers (lines ending with :)
      if (/^[A-Z][^.!?]*:$/m.test(para)) {
        return para.replace(/^([A-Z][^:]*):$/gm, '## $1');
      }

      return para;
    })
    .join('\n\n');

  return formatted;
}
