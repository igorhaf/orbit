'use client';

import type { MouseEvent } from 'react';

export function skipToMain(
  event: Pick<MouseEvent<HTMLAnchorElement>, 'preventDefault'>,
  documentRef: Pick<Document, 'querySelector'> = document,
) {
  const main = documentRef.querySelector<HTMLElement>('main');
  if (!main) return false;

  event.preventDefault();
  if (!main.id) main.id = 'main-content';
  main.tabIndex = -1;
  main.focus({ preventScroll: true });
  main.scrollIntoView({ block: 'start' });
  return true;
}

export function SkipToMain() {
  function skip(event: MouseEvent<HTMLAnchorElement>) {
    skipToMain(event);
  }

  return <a
    href="#main-content"
    onClick={skip}
    className="fixed left-3 top-3 z-[200] -translate-y-[150%] rounded-lg border border-cyan-200 bg-[#1d2125] px-4 py-3 text-sm font-semibold text-white shadow-xl transition-transform focus:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
  >
    Ir para o conteúdo principal
  </a>;
}
