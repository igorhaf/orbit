"use client";

import { ReactNode, useState } from "react";
import { AiEffort, AiModel } from "@/lib/api";

export function aiModelLabel(value: string | null | undefined, models: AiModel[]) {
  const selected = models.find((model) => model.id === value);
  return selected ? `${selected.version} · ${selected.name}` : "não configurado";
}

export function AiModelFields({
  value,
  inheritedValue,
  models,
  disabled = false,
  onSave,
  showActions = true,
  actions,
  saveOnChange = false,
}: {
  value: string | null | undefined;
  inheritedValue?: string | null;
  models: AiModel[];
  disabled?: boolean;
  onSave: (value: string | null) => Promise<void> | void;
  showActions?: boolean;
  actions?: ReactNode;
  saveOnChange?: boolean;
}) {
  const selected = models.find((model) => model.id === value);
  const [draft, setDraft] = useState<{ source: string | null | undefined; name: string; version: string } | null>(null);
  const useSource = !draft || draft.source !== value;
  const name = useSource ? selected?.name || "" : draft.name;
  const version = useSource ? selected?.version || "" : draft.version;
  const versions = [...new Set(models.filter((model) => model.name === name).map((model) => model.version))];
  const next = models.find((model) => model.name === name && model.version === version);
  const modelNames = [...new Set(models.map((model) => model.name))];

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs font-semibold">
          Modelo
          <select disabled={disabled} value={name} onChange={(event) => setDraft({ source: value, name: event.target.value, version: "" })} className="mt-1 w-full rounded border border-[#8590a2] bg-white p-2 text-sm font-normal">
            <option value="">Escolha um modelo</option>
            {modelNames.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold">
          Versão
          <select disabled={disabled || !name} value={version} onChange={(event) => {
            const nextVersion = event.target.value;
            setDraft({ source: value, name, version: nextVersion });
            const nextModel = models.find((model) => model.name === name && model.version === nextVersion);
            if (saveOnChange && nextModel) void onSave(nextModel.id);
          }} className="mt-1 w-full rounded border border-[#8590a2] bg-white p-2 text-sm font-normal">
            <option value="">Escolha uma versão</option>
            {versions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      {inheritedValue && <p className="text-xs text-[#626f86]">Referência: {aiModelLabel(inheritedValue, models)}</p>}
      {(showActions !== false || actions) && <div className="flex items-center gap-3">
        {showActions !== false && <>
          <button type="button" disabled={disabled || !next || next.id === value} onClick={() => next && void onSave(next.id)} className="rounded bg-[#0c66e4] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Salvar modelo</button>
          {value && <button type="button" disabled={disabled} onClick={() => void onSave(null)} className="text-xs font-semibold text-[#626f86] disabled:opacity-50">Usar referência</button>}
        </>}
        {actions}
      </div>}
    </div>
  );
}

const efforts: { id: AiEffort; label: string }[] = [
  { id: "low", label: "Baixo" },
  { id: "medium", label: "Médio" },
  { id: "high", label: "Alto" },
  { id: "xhigh", label: "Muito alto" },
];

export function AiEffortField({
  value,
  inheritedValue,
  disabled = false,
  onChange,
}: {
  value: AiEffort | null | undefined;
  inheritedValue?: AiEffort | null;
  disabled?: boolean;
  onChange: (value: AiEffort | null) => Promise<void> | void;
}) {
  const effectiveValue = value || inheritedValue || "medium";
  const level = efforts.findIndex((item) => item.id === effectiveValue);
  const currentLabel = efforts[level]?.label || "Médio";
  return (
    <label className="block text-xs font-semibold">
      <span className="flex items-center justify-between gap-2">
        <span>Esforço</span>
        <span className="font-normal text-[#626f86]">{currentLabel}</span>
      </span>
      <input
        disabled={disabled}
        type="range"
        min={0}
        max={efforts.length - 1}
        step={1}
        value={Math.max(0, level)}
        aria-label="Esforço da IA"
        onChange={(event) => void onChange(efforts[Number(event.target.value)].id)}
        className="mt-3 w-full cursor-pointer accent-[#6e5dc6] disabled:cursor-not-allowed"
      />
      <span className="mt-1 flex justify-between text-[10px] font-normal text-[#626f86]">
        {efforts.map((item) => <span key={item.id}>{item.label}</span>)}
      </span>
    </label>
  );
}
