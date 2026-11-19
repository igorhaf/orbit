'use strict';

// Shared pure engine extracted from tools/orbit/knowledge.mjs. No filesystem,
// cache, clock, model or authorization is available in this module.
const lexicalAlgorithm = 'orbit-bm25-lexical/1';
const lexicalChunkAlgorithm = 'orbit-structural-chunks/1';
const lexicalWords = text => {
  if (typeof text !== 'string') throw new TypeError('Lexical text must be a string.');
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || [];
};
const stableCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/** Same BM25 constants/formula/rounding as the original development CLI.
 * `tokens`, when supplied, are the complete scoring input (including any label).
 * The caller supplies only authorized documents and owns cache invalidation.
 */
function rankLexical(query, documents, options = {}) {
  if (!Array.isArray(documents)) throw new TypeError('Lexical documents must be an array.');
  const terms = [...new Set(lexicalWords(query))];
  const ids = new Set();
  const tokenized = documents.map(document => {
    if (!document || typeof document.id !== 'string' || !document.id || ids.has(document.id)) throw new TypeError('Lexical document ids must be unique strings.');
    ids.add(document.id);
    if (document.tokens !== undefined) {
      if (!Array.isArray(document.tokens) || document.tokens.some(token => typeof token !== 'string')) throw new TypeError('Lexical token vectors must contain strings.');
      return document.tokens;
    }
    if (typeof document.text !== 'string' || document.label !== undefined && typeof document.label !== 'string') throw new TypeError('Lexical documents require text or tokens.');
    return lexicalWords(document.label === undefined ? document.text : `${document.label} ${document.text}`);
  });
  if (!terms.length || !documents.length) return [];
  const counts = new Map(terms.map(term => [term, 0]));
  const frequencies = tokenized.map(items => {
    const frequency = new Map();
    for (const token of items) frequency.set(token, (frequency.get(token) || 0) + 1);
    for (const term of terms) if (frequency.has(term)) counts.set(term, counts.get(term) + 1);
    return frequency;
  });
  const averageLength = tokenized.reduce((sum, item) => sum + item.length, 0) / (tokenized.length || 1);
  const tieBreak = options.tieBreak || ((left, right) => stableCompare(left.id, right.id));
  if (typeof tieBreak !== 'function') throw new TypeError('Lexical tie-break must be a function.');
  return documents.map((document, index) => {
    const items = tokenized[index], matchedTerms = [];
    let score = 0;
    for (const term of terms) {
      const frequency = frequencies[index].get(term) || 0;
      const idf = Math.log(1 + (documents.length - counts.get(term) + 0.5) / (counts.get(term) + 0.5));
      score += idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * items.length / (averageLength || 1)));
      if (frequency) matchedTerms.push(term);
    }
    return {document, score: Math.round(score * 1_000_000) / 1_000_000, matchedTerms};
  }).filter(item => item.score > 0).sort((left, right) => right.score - left.score || tieBreak(left.document, right.document));
}

/** Structural, lossless excerpts. Oversized paragraphs/fences are omitted whole,
 * never silently truncated. Positions are UTF-16 string offsets and1-based lines.
 * Original CRLF and document bytes are retained inside every excerpt.
 */
function chunkLexical(text, options = {}) {
  if (typeof text !== 'string') throw new TypeError('Chunk text must be a string.');
  const maxBytes = options.maxBytes === undefined ? 4096 : options.maxBytes;
  const maxChunks = options.maxChunks === undefined ? 256 : options.maxChunks;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 256 || maxBytes > 65536 || !Number.isSafeInteger(maxChunks) || maxChunks < 1 || maxChunks > 4096) throw new RangeError('Invalid structural chunk limits.');
  const lines = text.split('\n'), offsets = [];
  let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
  const blank = line => !line.trim();
  const fence = line => /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r$/, ''));
  const heading = line => /^ {0,3}#{1,6}\s+\S/.test(line);
  const chunks = [], omissions = [];
  let cursor = 0, currentHeading = null;
  while (cursor < lines.length) {
    if (blank(lines[cursor])) { cursor++; continue; }
    const start = cursor, opening = fence(lines[cursor]);
    let kind = 'paragraph';
    if (opening) {
      kind = 'code';cursor++;
      while (cursor < lines.length) {
        const closing = fence(lines[cursor]);cursor++;
        if (closing && closing[1][0] === opening[1][0] && closing[1].length >= opening[1].length && !closing[2].trim()) break;
      }
    } else if (heading(lines[cursor])) {
      kind = 'heading';currentHeading = lines[cursor].trim();cursor++;
    } else {
      cursor++;
      while (cursor < lines.length && !blank(lines[cursor]) && !heading(lines[cursor]) && !fence(lines[cursor])) cursor++;
    }
    const endOffset = cursor < lines.length ? offsets[cursor] - 1 : text.length;
    const location = {startLine:start + 1, endLine:cursor, startOffset:offsets[start], endOffset, heading:currentHeading, kind};
    const excerpt = text.slice(location.startOffset, endOffset);
    if (Buffer.byteLength(excerpt, 'utf8') > maxBytes) omissions.push({...location, reason:'oversized_block'});
    else if (chunks.length >= maxChunks) omissions.push({...location, reason:'chunk_limit'});
    else chunks.push({...location, text:excerpt});
  }
  return {algorithm:lexicalChunkAlgorithm, chunks, omissions};
}

module.exports = {lexicalAlgorithm,lexicalChunkAlgorithm,lexicalWords,rankLexical,chunkLexical};
