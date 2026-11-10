import sanitizeHtml from 'sanitize-html';
import { BadRequestException } from '@nestjs/common';

const allowedTags = [
  'a', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'img', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong', 'table', 'tbody', 'td', 'th',
  'thead', 'tr', 'u', 'ul',
];

const safeColors = [/^#[\da-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^hsla?\([\d\s.,%deg]+\)$/i, /^(?:black|white|red|green|blue|gray|grey|transparent)$/i];

export function sanitizeNotebookHtml(input: unknown): string {
  if (typeof input !== 'string' || input.length > 500_000) throw new BadRequestException('Texto inválido.');
  return sanitizeHtml(input, {
    allowedTags,
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      '*': ['style'],
    },
    allowedStyles: {
      '*': {
        'background-color': safeColors,
        color: safeColors,
        'font-family': [/^[\w\s,"'-]{1,100}$/],
        'font-size': [/^(?:\d+(?:\.\d+)?(?:px|pt|em|rem|%)|small|medium|large|x-small|x-large)$/i],
        'font-style': [/^(?:normal|italic|oblique)$/i],
        'font-weight': [/^(?:normal|bold|[1-9]00)$/i],
        'line-height': [/^(?:normal|\d+(?:\.\d+)?(?:px|em|rem|%)?)$/i],
        'text-align': [/^(?:left|right|center|justify|start|end)$/i],
        'text-decoration': [/^(?:none|underline|line-through|overline)$/i],
        'white-space': [/^(?:normal|pre|pre-wrap|pre-line)$/i],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
  });
}
