"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type DriveConnection = { id: string; name: string; pluginId: string };
type DriveSettings = { configured: boolean; api_key: string | null; app_id: string | null; connections: DriveConnection[] };
type PickerDoc = { id?: string; name?: string; mimeType?: string };
type PickerBuilder = {
  addView(view: unknown): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  setAppId(value: string): PickerBuilder;
  setCallback(callback: (data: { action?: string; docs?: PickerDoc[] }) => void): PickerBuilder;
  setDeveloperKey(value: string): PickerBuilder;
  setOAuthToken(value: string): PickerBuilder;
  setOrigin(value: string): PickerBuilder;
  build(): { setVisible(value: boolean): void };
};
type GooglePicker = {
  Action: { PICKED: string };
  DocsView: new (viewId: string) => { setIncludeFolders(value: boolean): unknown; setSelectFolderEnabled(value: boolean): unknown };
  PickerBuilder: new () => PickerBuilder;
  ViewId: { DOCS: string };
};
type GoogleWindow = Window & {
  gapi?: { load(name: string, callback: () => void): void };
  google?: { picker: GooglePicker };
};

function loadGooglePicker(): Promise<GooglePicker> {
  return new Promise((resolve, reject) => {
    const host = window as GoogleWindow;
    const load = () => {
      if (!host.gapi) return reject(new Error("A biblioteca do Google Picker não carregou."));
      host.gapi.load("picker", () => host.google?.picker ? resolve(host.google.picker) : reject(new Error("O Google Picker não ficou disponível.")));
    };
    if (host.google?.picker && host.gapi) return load();
    const existing = document.querySelector<HTMLScriptElement>('script[data-suinda-google-picker="true"]');
    if (existing) {
      existing.addEventListener("load", load, { once: true });
      if (host.gapi) load();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.defer = true;
    script.dataset.suindaGooglePicker = "true";
    script.onload = load;
    script.onerror = () => reject(new Error("Não foi possível carregar o seletor do Google Drive."));
    document.head.appendChild(script);
  });
}

export default function SuindaGoogleDriveImport({ lessonId, revision, onImported }: { lessonId: string; revision: number; onImported: () => void }) {
  const [settings, setSettings] = useState<DriveSettings | null>(null);
  const [connectionId, setConnectionId] = useState("");
  const [altText, setAltText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    try {
      const result = await api<DriveSettings>("/suinda-google-drive/settings");
      setSettings(result);
      setConnectionId((current) => result.connections.some((connection) => connection.id === current) ? current : result.connections[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível consultar as contas Google.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void api<DriveSettings>("/suinda-google-drive/settings").then((result) => {
      if (!active) return;
      setSettings(result);
      setConnectionId(result.connections[0]?.id || "");
      const returned = sessionStorage.getItem("suinda.google-drive.message");
      if (returned) { setMessage(returned); sessionStorage.removeItem("suinda.google-drive.message"); }
      const params = new URLSearchParams(window.location.search);
      const callbackError = params.get("drive_error");
      if (callbackError) setError(callbackError);
      if (params.has("drive_connected") || params.has("drive_error")) {
        params.delete("drive_connected"); params.delete("drive_error");
        window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
      }
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Não foi possível consultar as contas Google."); });
    return () => { active = false; };
  }, []);

  async function connect() {
    setBusy(true); setError(""); setMessage("");
    try {
      sessionStorage.setItem("suinda.google-drive.return-to", `${window.location.pathname}${window.location.search}${window.location.hash}`);
      const result = await api<{ url: string }>("/suinda-google-drive/oauth/start", { method: "POST", body: JSON.stringify({}) });
      window.location.assign(result.url);
    } catch (cause) {
      setBusy(false); setError(cause instanceof Error ? cause.message : "Não foi possível iniciar a conexão Google.");
    }
  }

  async function openPicker() {
    if (!settings?.configured || !connectionId || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const token = await api<{ access_token: string }>("/suinda-google-drive/picker-token", { method: "POST", body: JSON.stringify({ connection_id: connectionId }) });
      const picker = await loadGooglePicker();
      const view = new picker.DocsView(picker.ViewId.DOCS);
      view.setIncludeFolders(false);
      view.setSelectFolderEnabled(false);
      const dialog = new picker.PickerBuilder()
        .addView(view)
        .setAppId(settings.app_id!)
        .setDeveloperKey(settings.api_key!)
        .setOAuthToken(token.access_token)
        .setOrigin(`${window.location.protocol}//${window.location.host}`)
        .setCallback((data) => {
          if (data.action !== picker.Action.PICKED) { setBusy(false); return; }
          const selected = data.docs?.[0];
          if (!selected?.id) { setBusy(false); setError("O Google Picker não retornou um arquivo válido."); return; }
          if (selected.mimeType?.startsWith("image/") && !altText.trim()) { setBusy(false); setError("Antes de importar uma imagem, escreva sua descrição alternativa no campo abaixo."); return; }
          void api(`/suinda-google-drive/lessons/${encodeURIComponent(lessonId)}/import`, {
            method: "POST",
            body: JSON.stringify({ connection_id: connectionId, file_id: selected.id, expected_revision: revision, operation_key: crypto.randomUUID(), alt_text: altText.trim() }),
          }).then(() => {
            setMessage(`“${selected.name || "Arquivo"}” foi importado, verificado e anexado à revisão ${revision}.`);
            onImported();
          }).catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível importar o arquivo selecionado."))
            .finally(() => setBusy(false));
        })
        .build();
      dialog.setVisible(true);
      setBusy(false);
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir o Google Picker.");
    }
  }

  return <section className="grid gap-2 rounded-lg border border-cyan-200/15 bg-cyan-200/[0.035] p-3" aria-label="Importação de materiais do Google Drive">
    <div><h4 className="text-xs font-semibold text-cyan-100">Google Drive</h4><p className="mt-1 text-xs leading-5 text-[#9fadbc]">Escolha um arquivo pelo seletor oficial. O Suindá copia somente o arquivo selecionado, passa-o pela validação e pelo scanner e o anexa à revisão atual.</p></div>
    {settings && !settings.configured && <p className="text-xs text-amber-100">Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_PICKER_API_KEY e GOOGLE_CLOUD_PROJECT_NUMBER na API para ativar o Drive.</p>}
    {settings?.configured && settings.connections.length > 0 && <div className="flex flex-wrap items-end gap-2">
      {settings.connections.length > 1 && <label className="grid gap-1 text-xs text-[#b6c2cf]">Conta Google<select value={connectionId} onChange={(event) => setConnectionId(event.target.value)} className="min-h-9 min-w-48 rounded-lg border border-[#3b4754] bg-[#1d2125] px-2 text-xs text-white">{settings.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></label>}
      <button type="button" disabled={busy || !connectionId} onClick={() => void openPicker()} className="min-h-9 rounded-lg border border-cyan-200/25 px-3 text-xs font-semibold text-cyan-100 hover:bg-cyan-200/[0.07] disabled:opacity-50">{busy ? "Abrindo…" : "Selecionar arquivo do Drive"}</button>
      <button type="button" disabled={busy} onClick={() => void connect()} className="min-h-9 rounded-lg border border-[#3b4754] px-3 text-xs text-[#b6c2cf] hover:bg-white/[0.04] disabled:opacity-50">Conectar outra conta</button>
    </div>}
    {settings?.configured && <label className="grid gap-1 text-xs text-[#b6c2cf]">Descrição alternativa da imagem (necessária ao selecionar uma imagem)<input value={altText} onChange={(event) => setAltText(event.target.value)} maxLength={500} className="min-h-10 rounded-lg border border-[#3b4754] bg-[#1d2125] px-3 text-xs text-white" placeholder="Descreva o conteúdo e a finalidade da imagem" /></label>}
    {settings?.configured && settings.connections.length === 0 && <button type="button" disabled={busy} onClick={() => void connect()} className="min-h-9 justify-self-start rounded-lg border border-cyan-200/25 px-3 text-xs font-semibold text-cyan-100 hover:bg-cyan-200/[0.07] disabled:opacity-50">{busy ? "Conectando…" : "Conectar Google Drive"}</button>}
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    {message && <p role="status" aria-live="polite" className="text-xs text-emerald-200">{message}</p>}
    <button type="button" onClick={() => void refresh()} className="justify-self-start text-[11px] text-[#9fadbc] underline underline-offset-2 hover:text-white">Atualizar contas conectadas</button>
  </section>;
}
