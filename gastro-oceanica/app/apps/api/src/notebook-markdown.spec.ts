import assert from 'node:assert/strict';
import test from 'node:test';
import { notebookHtmlToMarkdown } from './notebook-markdown';

test('notebook content becomes card Markdown with common formatting', () => {
  const markdown = notebookHtmlToMarkdown('<h1>Plano</h1><p>Texto <strong>forte</strong> e <a href="https://example.com">link</a>.</p><ul><li>Primeiro</li><li>Segundo</li></ul><pre><code>const x = 1;</code></pre>');
  assert.match(markdown, /^# Plano/m);
  assert.match(markdown, /Texto \*\*forte\*\* e \[link\]\(https:\/\/example\.com\)/);
  assert.match(markdown, /-\s+Primeiro\n-\s+Segundo/);
  assert.match(markdown, /```\nconst x = 1;\n```/);
});

test('notebook tables become GitHub-flavored Markdown and active markup is discarded', () => {
  const markdown = notebookHtmlToMarkdown('<table><thead><tr><th>Nome</th><th>Valor</th></tr></thead><tbody><tr><td>A</td><td>1</td></tr></tbody></table><script>alert(1)</script>');
  assert.match(markdown, /\| Nome \| Valor \|/);
  assert.match(markdown, /\| A +\| 1 +\|/);
  assert.doesNotMatch(markdown, /alert\(1\)/);
});
