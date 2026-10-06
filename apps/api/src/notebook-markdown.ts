import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const converter = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
});

converter.use(gfm);
converter.remove(['script', 'style', 'iframe', 'object', 'embed', 'form', 'button']);

export function notebookHtmlToMarkdown(html: string): string {
  return converter.turndown(html).trim();
}
