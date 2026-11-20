'use client';
import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const modalStack: symbol[] = [];
const modalElements = new Map<symbol, HTMLElement>();
const subscribeToHydration = () => () => {};
const getHydratedSnapshot = () => true;
const getServerSnapshot = () => false;
export function Modal({ children, onClose, wide = false, extraWide = false, sidePanel = false, title, ariaLabel, restoreFocusTo, theme = process.env.NEXT_PUBLIC_ORBIT_THEME === "dark" ? "dark" : "light" }: { children: ReactNode; onClose: () => void; wide?: boolean; extraWide?: boolean; sidePanel?: boolean; title?: string; ariaLabel?: string; restoreFocusTo?: HTMLElement | null; theme?: "light" | "dark" }) {
  const mounted = useSyncExternalStore(subscribeToHydration, getHydratedSnapshot, getServerSnapshot);
  const modalId = useRef(Symbol('modal'));
  const generatedLabelId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(restoreFocusTo ?? null);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => { restoreFocusRef.current = restoreFocusTo ?? null; }, [restoreFocusTo]);
  useEffect(() => {
    if (!mounted || title || ariaLabel) return;
    const dialog = dialogRef.current;
    const heading = dialog?.querySelector<HTMLElement>('h1, h2, h3');
    if (!dialog || !heading) return;
    if (!heading.id) heading.id = `modal-title-${generatedLabelId.replaceAll(':', '')}`;
    dialog.setAttribute('aria-labelledby', heading.id);
    dialog.removeAttribute('aria-label');
    return () => {
      if (dialog.getAttribute('aria-labelledby') === heading.id) dialog.removeAttribute('aria-labelledby');
    };
  }, [ariaLabel, generatedLabelId, mounted, title]);
  useEffect(() => {
    const id = modalId.current;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalStack.push(id);
    if (dialogRef.current) modalElements.set(id, dialogRef.current);
    const focusableElements = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ) ?? []).filter(element => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');
    const focusDialog = () => {
      const dialog = dialogRef.current;
      if (!dialog || modalStack.at(-1) !== id) return;
      const target = dialog.querySelector<HTMLElement>('[data-autofocus], [autofocus]') ?? focusableElements()[0] ?? dialog;
      target.focus();
    };
    const handler = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== id) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      const focusable = focusableElements();
      if (!dialog || focusable.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handler);
    const frame = window.requestAnimationFrame(focusDialog);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handler);
      const index = modalStack.lastIndexOf(id);
      if (index >= 0) modalStack.splice(index, 1);
      modalElements.delete(id);
      const requestedTarget = restoreFocusRef.current;
      const previous = requestedTarget?.isConnected ? requestedTarget : previousFocusRef.current;
      window.requestAnimationFrame(() => {
        const topId = modalStack.at(-1);
        const topDialog = topId ? modalElements.get(topId) ?? null : null;
        if (previous?.isConnected && (!topDialog || topDialog.contains(previous))) previous.focus();
        else if (topDialog) (topDialog.querySelector<HTMLElement>('[data-autofocus], [autofocus]') ?? topDialog.querySelector<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? topDialog).focus();
      });
    };
  }, []);
  if (!mounted) return null;
  return createPortal(<div className={sidePanel?"fixed inset-0 z-50 overflow-hidden bg-[#091e4240]":"fixed inset-0 z-50 flex min-h-full items-center justify-center overflow-y-auto bg-[#091e42b8] p-2 backdrop-blur-[3px] sm:p-6"} onMouseDown={e => { if (e.target === e.currentTarget && modalStack.at(-1) === modalId.current) onClose(); }}>
    <div ref={dialogRef} tabIndex={-1} onMouseDown={e => e.stopPropagation()} data-side-panel={sidePanel||undefined} className={sidePanel?`side-panel-in fixed inset-y-0 right-0 flex h-dvh w-full min-w-0 max-w-[900px] flex-col overflow-hidden border-l ${theme === 'dark' ? 'border-[#3b4754] bg-[#1d2125] text-[#dee4ea]' : 'border-[#dfe1e6] bg-white'} shadow-dialog`:`fade-in relative max-h-[calc(100dvh-1rem)] w-full overflow-y-auto ${extraWide ? 'max-w-[1350px]' : wide ? 'max-w-[820px]' : 'max-w-[560px]'} rounded-xl border ${theme === 'dark' ? 'border-[#3b4754] bg-[#1d2125] text-[#dee4ea] shadow-2xl' : 'border-[#dfe1e6] bg-white shadow-dialog'} sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl`} role="dialog" aria-modal="true" aria-label={ariaLabel || title || 'Janela de diálogo'}>
      {sidePanel?<div data-side-panel-content className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">{children}</div>:children}
      <button aria-label="Fechar" onClick={onClose} className={`absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${theme === 'dark' ? 'text-[#9fadbc] hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300' : 'text-[#626f86] hover:bg-[#f1f2f4] hover:text-[#172b4d]'} ${sidePanel?`z-10 border ${theme === 'dark' ? 'border-[#46515c] bg-[#252b31]' : 'border-[#dfe1e6] bg-white'} shadow-sm`:''}`}><X size={20}/></button>
    </div>
  </div>, document.body);
}
