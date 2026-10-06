"use client";
import { useEffect, useState } from "react";
import { GitCommitHorizontal, RotateCcw } from "lucide-react";
import { api, CardCommits, ExternalResource, send } from "@/lib/api";

function commitUrl(url: string | null) {
  if (!url) return undefined;
  try { return new URL(url).protocol === "https:" ? url : undefined; } catch { return undefined; }
}

export function CardCommitsPanel({ cardId, resources }: { cardId: string; resources: ExternalResource[] }) {
  const [result, setResult] = useState<CardCommits>({ commits: [], warnings: [] });
  const [loadedKey, setLoadedKey] = useState("");
  const [fetchError, setFetchError] = useState<{ key: string; message: string } | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [linking, setLinking] = useState(false);
  const [connections, setConnections] = useState<{ id: string; display_name: string }[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [repository, setRepository] = useState("");
  const [sha, setSha] = useState("");
  const [saving, setSaving] = useState(false);
  const linked = resources.some(resource => resource.plugin_id === "github" && ["commit", "pull_request"].includes(resource.resource_type));
  const shouldFetch = linked || revision > 0;
  const requestKey = `${cardId}:${revision}:${linked}`;
  const loading = shouldFetch && loadedKey !== requestKey;
  const visibleError = error || (fetchError?.key === requestKey ? fetchError.message : "");
  useEffect(() => {
    if (!shouldFetch) return;
    let active = true;
    void api<CardCommits>(`/github/cards/${cardId}/commits`).then(value => {
      if (active) { setResult(value); setLoadedKey(requestKey); setFetchError(null); }
    }).catch(err => { if (active) { setFetchError({ key: requestKey, message: (err as Error).message }); setLoadedKey(requestKey); } });
    return () => { active = false; };
  }, [cardId, requestKey, shouldFetch]);
  useEffect(() => {
    if (!linking) return;
    let active = true;
    void api<{ connections: { id: string; display_name: string }[] }>("/github/status").then(value => {
      if (active) { setConnections(value.connections); setConnectionId(value.connections[0]?.id || ""); }
    }).catch(err => { if (active) setError((err as Error).message); });
    return () => { active = false; };
  }, [linking]);
  async function link(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await send(`/github/cards/${cardId}/commits`, "POST", { connectionId, repository, sha });
      setLinking(false);
      setSha("");
      setRevision(value => value + 1);
    } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  }
  return <section aria-label="Commits do cartão" className="space-y-3">
    <div className="flex items-center gap-2">
      <h3 className="flex flex-1 items-center gap-2 text-sm font-bold"><GitCommitHorizontal size={17} /> Commits ({result.commits.length})</h3>
      <button type="button" onClick={() => setLinking(value => !value)} className="text-xs font-semibold text-[#0c66e4]">{linking ? "Cancelar" : "Vincular commit"}</button>
      <button type="button" aria-label="Atualizar commits" disabled={loading || saving} onClick={() => setRevision(value => value + 1)} className="rounded p-1 hover:bg-[#f1f2f4] disabled:opacity-50"><RotateCcw size={15} /></button>
    </div>
    {linking && <form onSubmit={link} className="space-y-2 rounded-lg border border-[#dfe1e6] p-3">
      {connections.length === 0 ? <p className="text-xs text-[#626f86]">Conecte sua conta GitHub nas integrações do perfil para vincular commits.</p> : <>
        <label className="block text-xs">Conexão<select value={connectionId} onChange={event => setConnectionId(event.target.value)} className="mt-1 w-full rounded border border-[#dfe1e6] p-2">{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.display_name}</option>)}</select></label>
        <label className="block text-xs">Repositório<input required placeholder="organização/repositório" value={repository} onChange={event => setRepository(event.target.value)} className="mt-1 w-full rounded border border-[#dfe1e6] p-2" /></label>
        <label className="block text-xs">SHA do commit<input required pattern="[a-fA-F0-9]{7,40}" value={sha} onChange={event => setSha(event.target.value)} className="mt-1 w-full rounded border border-[#dfe1e6] p-2 font-mono" /></label>
        <button type="submit" disabled={saving} className="rounded bg-[#0c66e4] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Vinculando…" : "Vincular"}</button>
      </>}
    </form>}
    {visibleError && <p role="alert" className="text-xs text-[#ae2a19]">{visibleError}</p>}
    {result.warnings.map((warning, index) => <p key={index} role="alert" className="text-xs text-[#ae2a19]">{warning}</p>)}
    {loading && <p role="status" className="text-xs text-[#626f86]">Carregando commits…</p>}
    {!loading && !visibleError && result.commits.length === 0 && result.warnings.length === 0 && <p className="text-xs text-[#626f86]">Nenhum commit vinculado a este cartão. Vincule um commit ou um pull request do GitHub.</p>}
    <ul className="max-h-80 space-y-2 overflow-y-auto">
      {result.commits.map(commit => {
        const date = commit.date ? new Date(commit.date) : null, url = commitUrl(commit.url);
        return <li key={`${commit.repository}:${commit.sha}`} className="rounded-lg border border-[#dfe1e6] p-3">
          <div className="flex items-center gap-2 text-xs"><code>{url ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-[#0c66e4] underline">{commit.sha.slice(0, 8)}</a> : commit.sha.slice(0, 8)}</code><span className="truncate text-[#626f86]">{commit.repository}</span>{commit.merge && <span className="rounded bg-[#e9eaed] px-1.5">Merge</span>}</div>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm">{commit.message}</p>
          <p className="mt-1 text-xs text-[#626f86]">{commit.author || "Autor não informado"}{date && !Number.isNaN(date.getTime()) && <> · <time dateTime={date.toISOString()}>{date.toLocaleString("pt-BR")}</time></>}</p>
        </li>;
      })}
    </ul>
  </section>;
}
