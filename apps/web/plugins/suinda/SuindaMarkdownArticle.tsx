'use client';

import React from 'react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Children, createElement, isValidElement, type ReactNode } from 'react';
import { hasAccessibleText } from '../../lib/accessibility-text';

const articleClasses = 'max-w-none break-words space-y-4 text-sm leading-7 text-[#b6c2cf] [&_a]:text-cyan-200 [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-cyan-100 [&_a:focus-visible]:rounded-sm [&_a:focus-visible]:outline [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-2 [&_a:focus-visible]:outline-cyan-300 [&_blockquote]:border-l-4 [&_blockquote]:border-[#536171] [&_blockquote]:pl-4 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:text-white [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-white [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-white [&_h4]:text-lg [&_h4]:font-semibold [&_h4]:text-white [&_h5]:text-base [&_h5]:font-semibold [&_h5]:text-white [&_h6]:text-sm [&_h6]:font-semibold [&_h6]:text-white [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_p]:whitespace-pre-wrap [&_strong]:text-white [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[#536171] [&_td]:p-2 [&_th]:border [&_th]:border-[#536171] [&_th]:bg-white/[0.04] [&_th]:p-2 [&_th]:text-left [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6';
const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

function markdownHeading(level: number, offset: number, children: ReactNode) {
  const tag = headingTags[Math.min(5, Math.max(0, level + offset - 1))];
  return createElement(tag, null, children);
}

function markdownText(children: ReactNode): string {
  return Children.toArray(children).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    return isValidElement<{ children?: ReactNode }>(child) ? markdownText(child.props.children) : '';
  }).join('');
}

/** Renders institution-authored lesson Markdown consistently in enrollment and subscription readers. */
export function SuindaMarkdownArticle({ markdown, headingOffset = 1 }: { markdown: string; headingOffset?: number }) {
  return <div className={articleClasses}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      h1: ({ children }) => markdownHeading(1, headingOffset, children),
      h2: ({ children }) => markdownHeading(2, headingOffset, children),
      h3: ({ children }) => markdownHeading(3, headingOffset, children),
      h4: ({ children }) => markdownHeading(4, headingOffset, children),
      h5: ({ children }) => markdownHeading(5, headingOffset, children),
      h6: ({ children }) => markdownHeading(6, headingOffset, children),
      a: ({ children, href }) => <a href={href} aria-label={hasAccessibleText(markdownText(children)) ? undefined : `Link sem descrição: ${href || 'destino desconhecido'}`}>{children}</a>,
      img: ({ alt, src, title }) => <Image src={typeof src === 'string' ? src : ''} alt={alt === '' ? '' : hasAccessibleText(alt) ? alt : 'Imagem sem descrição alternativa'} title={title} width={1200} height={800} unoptimized />,
    }}>{markdown}</ReactMarkdown>
  </div>;
}
