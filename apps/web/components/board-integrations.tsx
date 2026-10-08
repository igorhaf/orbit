"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  HardDrive,
  Mail,
  Plug,
  Trello,
} from "lucide-react";
import type { List, ListIntegration } from "@/lib/api";

function IntegrationRow({ list, integration, side }: {
  list: List;
  integration: ListIntegration;
  side: "left" | "right";
}) {
  const incoming = integration.direction === "inbound";
  const both = integration.direction === "bidirectional";
  const Arrow = both ? ArrowLeftRight : incoming === (side === "left") ? ArrowLeft : ArrowRight;
  const Icon = integration.service === "Trello" ? Trello
    : integration.service === "Gmail" ? Mail
    : integration.service === "Drive" ? HardDrive : Plug;
  const direction = both ? "Entrada e saída" : incoming ? "Entrada de dados" : "Saída de dados";
  const linkedList = (
    <div className="min-w-0 rounded-md bg-[#e9f2ff] p-2 text-[#0747a6]">
      <span className="block text-[10px] font-semibold">{side === "left" ? "Lista à esquerda" : "Lista à direita"}</span>
      <span className="mt-1 block break-words text-xs font-semibold">{list.title}</span>
    </div>
  );
  const unlinked = <span className="rounded-md border border-dashed border-[#dfe1e6] p-2 text-center text-[10px] text-[#626f86]">Sem vínculo deste lado</span>;

  return (
    <li className="rounded-lg border border-[#dfe1e6] bg-white p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold">
        <Icon size={17} aria-hidden="true" className="shrink-0 text-[#0c66e4]" />
        {integration.service}
        <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold ${!integration.enabled ? "bg-[#e9eaed] text-[#44546f]" : integration.last_error ? "bg-[#fff7d6] text-[#7f5f01]" : "bg-[#dffcf0] text-[#216e4e]"}`}>
          {!integration.enabled ? "Desativada" : integration.last_error ? "Com erro" : "Ativa"}
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] items-center gap-2">
        {side === "left" ? linkedList : unlinked}
        <div className="min-w-0 text-center">
          <div className={`flex items-center ${side === "left" ? "justify-start" : "justify-end"}`}>
            <Arrow size={28} aria-hidden="true" className="text-[#0c66e4]" />
          </div>
          <span className="block break-words text-[11px] font-semibold">{integration.source_name}</span>
          {integration.external_list_name && <span className="mt-1 block break-words text-[10px] text-[#626f86]">{integration.external_list_name}</span>}
        </div>
        {side === "right" ? linkedList : unlinked}
      </div>
      <p className="mt-3 text-[11px] text-[#626f86]">{direction} · {integration.service} {both ? "↔" : incoming ? "→" : "←"} {list.title}</p>
      {integration.last_error && <p className="mt-2 break-words rounded bg-[#fff7d6] p-2 text-[11px] text-[#7f5f01]">{integration.last_error}</p>}
    </li>
  );
}

export function BoardIntegrations({ left, right, expanded, onExpandedChange }: {
  left: List;
  right: List;
  expanded: boolean;
  onExpandedChange: (gap: string | null) => void;
}) {
  const panelId = useId();
  const rail = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const integrations = [
    ...(left.integrations || []).map(integration => ({ list: left, integration, side: "left" as const })),
    ...(right.integrations || []).map(integration => ({ list: right, integration, side: "right" as const })),
  ];

  useLayoutEffect(() => {
    if (!expanded || !rail.current) return;
    const scroll = rail.current.closest(".board-scroll");
    if (!scroll) return;
    const update = () => {
      const anchor = rail.current!.getBoundingClientRect();
      const bounds = scroll.getBoundingClientRect();
      const minLeft = Math.max(8, bounds.left + 8);
      const maxRight = Math.min(window.innerWidth - 8, bounds.right - 8);
      if (anchor.right < minLeft || anchor.left > maxRight) {
        onExpandedChange(null);
        return;
      }
      const available = Math.max(0, maxRight - minLeft);
      const width = Math.min(available, Math.max(320, Math.min(380, available * 0.5)));
      const top = Math.max(anchor.top, bounds.top + 8);
      setBox({
        top,
        left: Math.max(minLeft, Math.min(anchor.right + 4, maxRight - width)),
        width,
        height: Math.max(0, Math.min(anchor.bottom, bounds.bottom - 8, window.innerHeight - 8) - top),
      });
    };
    update();
    const focusFrame = requestAnimationFrame(() => closeButton.current?.focus({ preventScroll: true }));
    const observer = new ResizeObserver(update);
    observer.observe(scroll);
    observer.observe(rail.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const dismiss = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !rail.current?.contains(event.target as Node)) onExpandedChange(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => {
      cancelAnimationFrame(focusFrame);
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("pointerdown", dismiss);
    };
  }, [expanded, onExpandedChange]);

  const close = () => {
    onExpandedChange(null);
    rail.current?.focus({ preventScroll: true });
  };
  const label = `${expanded ? "Recolher" : "Expandir"} integrações entre ${left.title} e ${right.title}`;

  return (
    <>
      <button
        ref={rail}
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        onClick={() => expanded ? close() : onExpandedChange(`${left.id}:${right.id}`)}
        onKeyDown={event => { if (event.key === "Escape" && expanded) close(); }}
        className={`-mx-3 flex w-6 shrink-0 self-stretch flex-col items-center gap-3 rounded-lg border py-3 text-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-white ${expanded ? "border-white/60 bg-[#0c66e4]" : "border-white/20 bg-white/15 hover:bg-white/30"}`}
      >
        {expanded ? <ChevronLeft size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
        <Plug size={14} aria-hidden="true" />
        <span className="text-[10px] font-semibold [writing-mode:vertical-rl]">Integrações{integrations.length ? ` · ${integrations.length}` : ""}</span>
      </button>
      {expanded && box && createPortal(
        <aside
          ref={panel}
          id={panelId}
          aria-label={`Integrações entre ${left.title} e ${right.title}`}
          style={{ position: "fixed", ...box }}
          onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}
          className="z-40 flex min-h-0 flex-col overflow-hidden rounded-xl border border-[#dfe1e6] bg-[#f1f2f4] text-[#172b4d] shadow-xl"
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-[#dfe1e6] p-3">
            <Plug size={17} aria-hidden="true" className="text-[#0c66e4]" />
            <h2 className="min-w-0 flex-1 text-sm font-bold">Integrações</h2>
            <button ref={closeButton} type="button" onClick={close} aria-label="Recolher integrações" title="Recolher integrações" className="rounded p-1 hover:bg-[#dfe1e6] focus-visible:outline-2 focus-visible:outline-[#0c66e4]">
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
              <div className="min-w-0"><span className="block text-[10px] text-[#626f86]">À esquerda</span><span className="block break-words font-semibold">{left.title}</span></div>
              <div className="min-w-0 text-right"><span className="block text-[10px] text-[#626f86]">À direita</span><span className="block break-words font-semibold">{right.title}</span></div>
            </div>
            <p className="mb-3 text-[11px] leading-4 text-[#626f86]">As setas indicam entrada ou saída de dados em cada lista. Os vínculos de cada lado são independentes.</p>
            {integrations.length ? <ul className="space-y-3">{integrations.map(({ list, integration, side }) => <IntegrationRow key={`${list.id}:${integration.id}`} list={list} integration={integration} side={side} />)}</ul> : (
              <div className="rounded-lg border border-dashed border-[#b3b9c4] bg-white p-5 text-center">
                <Plug size={24} aria-hidden="true" className="mx-auto mb-3 text-[#8590a2]" />
                <p className="text-sm font-semibold">Nenhuma integração nestas listas</p>
                <p className="mt-2 text-xs leading-5 text-[#626f86]">Conecte um quadro pelo menu do quadro e associe uma lista em “Integração Trello”, no menu da lista.</p>
              </div>
            )}
          </div>
        </aside>, document.body,
      )}
    </>
  );
}
