import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeNotebookHtml } from './notebook-sanitizer';

test('notebook HTML removes active tags and malformed event attributes', () => {
  const clean = sanitizeNotebookHtml('<svg/onload=alert(1)><p onclick="run()">Texto</p><script>run()</script>');
  assert.equal(clean, '<p>Texto</p>');
});

test('notebook HTML removes executable URLs and unsafe CSS while preserving safe formatting', () => {
  const clean = sanitizeNotebookHtml('<p style="color:#123456;text-align:center;background-image:url(javascript:run())" onmouseover=run()>Seguro <strong>formatado</strong> <a href="javascript:run()">link</a></p>');
  assert.match(clean, /^<p style="color:#123456;text-align:center;?">Seguro <strong>formatado<\/strong> <a>link<\/a><\/p>$/);
  assert.doesNotMatch(clean, /javascript|onmouseover|background-image/i);
});

test('notebook HTML retains safe links and image URLs while rejecting protocol-relative URLs', () => {
  const clean = sanitizeNotebookHtml('<a href="https://example.test/docs">Docs</a> <a href="//evil.test">outside</a><img src="https://example.test/image.png" onerror=run()>');
  assert.match(clean, /<a href="https:\/\/example\.test\/docs">Docs<\/a>/);
  assert.match(clean, /<a>outside<\/a>/);
  assert.match(clean, /<img src="https:\/\/example\.test\/image\.png" \/>/);
  assert.doesNotMatch(clean, /onerror|evil\.test/i);
});

test('notebook sanitizer rejects non-text and oversized input', () => {
  assert.throws(() => sanitizeNotebookHtml(null), /Texto inválido/);
  assert.throws(() => sanitizeNotebookHtml('x'.repeat(500_001)), /Texto inválido/);
});
