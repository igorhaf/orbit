import assert from 'node:assert/strict';
import React from 'react';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SuindaMarkdownArticle } from './SuindaMarkdownArticle';

test('o leitor de aulas renderiza a semântica Markdown em listas, títulos, links e imagens', () => {
  const html = renderToStaticMarkup(<SuindaMarkdownArticle headingOffset={2} markdown={'# Módulo acessível\n\n## Conteúdo\n\n[Material complementar](https://example.test/material)\n\n![Mapa da trilha](https://example.test/mapa.png)\n\n- Primeira etapa\n- Segunda etapa'} />);
  assert.match(html, /<h3>Módulo acessível<\/h3>/);
  assert.match(html, /<h4>Conteúdo<\/h4>/);
  assert.match(html, /<a href="https:\/\/example\.test\/material">Material complementar<\/a>/);
  assert.match(html, /<img alt="Mapa da trilha"[^>]*src="https:\/\/example\.test\/mapa\.png"/);
  assert.match(html, /<ul>[\s\S]*<li>Primeira etapa<\/li>[\s\S]*<li>Segunda etapa<\/li>[\s\S]*<\/ul>/);
});

test('o leitor por assinatura mantém headings dentro da hierarquia da aula', () => {
  const html = renderToStaticMarkup(<SuindaMarkdownArticle headingOffset={5} markdown={'# Aula\n\n## Seção'} />);
  assert.match(html, /<h6>Aula<\/h6>/);
  assert.match(html, /<h6>Seção<\/h6>/);
});

test('imagem Markdown decorativa mantém alt vazio para ser ignorada por leitor de tela', () => {
  const html = renderToStaticMarkup(<SuindaMarkdownArticle markdown={'![](https://example.test/divisor.png)'} />);
  assert.match(html, /<img alt=""[^>]*src="https:\/\/example\.test\/divisor\.png"/);
});

test('conteúdo Markdown legado dá nomes acessíveis a links vazios e imagens sem descrição', () => {
  const html = renderToStaticMarkup(<SuindaMarkdownArticle markdown={'[](https://example.test/empty)\n\n![\u200b\u2069](https://example.test/unlabeled.png)'} />);
  assert.match(html, /aria-label="Link sem descrição: https:\/\/example\.test\/empty"/);
  assert.match(html, /alt="Imagem sem descrição alternativa"/);
});
