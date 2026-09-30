"use client";
import { ChangeEvent, ClipboardEvent, DragEvent, useEffect, useState } from "react";
import {
  Copy,
  Eye,
  LoaderCircle,
  Mail,
  Paperclip,
  Pencil,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import {
  Board,
  Card,
  CardDetails,
  Comment,
  commentAttachmentBlob,
  cardUrl,
  getToken,
  send,
  WatchState,
} from "@/lib/api";
import { Avatar } from "./ui";
import { RichText } from "./rich-text";
import Image from "next/image";

type PendingAttachment = {
  kind: "file";
  name: string;
  mime_type?: string;
  data?: string;
};
const asData = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.readAsDataURL(file);
  });

function ImageAttachment({ id, name }: { id: string; name: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void commentAttachmentBlob(id).then(blob => {
      objectUrl = URL.createObjectURL(blob);
      if (active) setUrl(objectUrl);
    }).catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id]);
  return url ? <Image unoptimized src={url} alt={name} width={640} height={320} className="mt-1 h-auto max-h-64 max-w-full rounded border border-[#dfe1e6] object-contain" /> : null;
}

export function CardComments({
  card,
  board,
  details,
  onChanged,
  run,
  user,
}: {
  card: Card;
  board: Board;
  details: CardDetails;
  onChanged: () => Promise<void>;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  user: { id: string; name: string; avatar_url?: string | null } | null;
}) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [editing, setEditing] = useState<Comment | null>(null);
  const [editBody, setEditBody] = useState("");
  const [watches, setWatches] = useState<WatchState | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [aiResult, setAiResult] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("comment");
    if (id)
      document
        .getElementById(`comment-${id}`)
        ?.scrollIntoView({ block: "center" });
  }, [details.comments]);
  async function addPendingFiles(files: File[]) {
    try {
      const entries = await Promise.all(
        files.map(async (file) => ({
          kind: "file" as const,
          name: file.name,
          mime_type: file.type || "application/octet-stream",
          data: await asData(file),
        })),
      );
      setPending(current => [...current, ...entries].slice(0, 10));
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    await addPendingFiles(Array.from(event.target.files || []));
    event.target.value = "";
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim() && !pending.length) return;
    const ok = await run(() =>
      send(`/cards/${card.id}/comments`, "POST", {
        body: body.trim() || "Imagem anexada.",
        attachments: pending,
      }),
    );
    if (ok) {
      setBody("");
      setPending([]);
    }
  }
  async function commentAi(
    action: "write" | "refine" | "summarize" | "shorten",
  ) {
    setAiBusy(true);
    setError("");
    setAiResult("");
    try {
      const result = await send<{ output: string }>(
        `/cards/${card.id}/comments/ai`,
        "POST",
        { action, draft: body },
      );
      setAiResult(result.output);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAiBusy(false);
    }
  }
  async function copyLink(comment: Comment) {
    const link = `${window.location.origin}${cardUrl(board.id, card.id, card.url_token)}&comment=${comment.id}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      setError("Não foi possível copiar o link.");
    }
  }
  async function download(id: string, name: string) {
    try {
      const blob = await commentAttachmentBlob(id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function toggle(scope: "card" | "list" | "board") {
    const target =
      scope === "card" ? card.id : scope === "list" ? card.list_id : board.id;
    await run(async () => {
      await send(
        `/${scope === "card" ? "cards" : scope === "list" ? "lists" : "boards"}/${target}/watch/toggle`,
        "POST",
      );
      setWatches(
        (await (
          await fetch(
            `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/cards/${card.id}/watches`,
            { headers: { Authorization: `Bearer ${getToken() || ""}` } },
          )
        ).json()) as WatchState,
      );
    });
  }
  async function loadWatches() {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/cards/${card.id}/watches`,
        { headers: { Authorization: `Bearer ${getToken() || ""}` } },
      );
      setWatches((await response.json()) as WatchState);
    } catch {
      setError("Não foi possível carregar acompanhamentos.");
    }
  }
  async function loadEmail() {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/cards/${card.id}/comment-email`,
        { headers: { Authorization: `Bearer ${getToken() || ""}` } },
      );
      const data = (await response.json()) as { address: string };
      setEmail(data.address);
    } catch {
      setError("Não foi possível gerar o endereço de e-mail.");
    }
  }
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-3 font-semibold">
          <Send size={21} /> Atividade
        </h3>
        <div className="flex gap-1">
          <button
            onClick={() => void loadWatches()}
            className="rounded bg-[#e9eaed] px-2 py-1 text-xs"
          >
            <Eye size={13} className="mr-1 inline" />
            Acompanhar
          </button>
          <button
            onClick={() => void loadEmail()}
            className="rounded bg-[#e9eaed] px-2 py-1 text-xs"
          >
            <Mail size={13} className="mr-1 inline" />
            E-mail
          </button>
        </div>
      </div>
      <div className="pl-0 sm:pl-8">
        {error && (
          <p role="alert" className="mb-2 text-xs text-[#ae2a19]">
            {error}
          </p>
        )}
        {watches && (
          <div className="mb-3 flex flex-wrap gap-2 rounded bg-[#e9f2ff] p-2 text-xs">
            <span>Receber atualizações:</span>
            {(["card", "list", "board"] as const).map((scope) => (
              <button
                key={scope}
                onClick={() => void toggle(scope)}
                className={`rounded px-2 py-1 ${watches[scope] ? "bg-[#0c66e4] text-white" : "bg-white text-[#172b4d]"}`}
              >
                {scope === "card"
                  ? "Cartão"
                  : scope === "list"
                    ? "Lista"
                    : "Quadro"}{" "}
                {watches[scope] ? "✓" : ""}
              </button>
            ))}
          </div>
        )}
        {email && (
          <div className="mb-3 rounded bg-[#f1f2f4] p-2 text-xs">
            <strong>Endereço para comentar:</strong>{" "}
            <code className="select-all">{email}</code>
            <p className="mt-1 text-[#626f86]">
              Configure o encaminhamento do provedor para o endpoint de entrada
              do Orbit.
            </p>
          </div>
        )}
        <form
          onSubmit={(event) => void submit(event)}
          className="rounded bg-white p-3 shadow-card"
        >
          <div className="flex gap-2">
            <Avatar
              name={user?.name || "Você"}
              url={user?.avatar_url}
              size="sm"
            />
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
                const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith("image/"));
                if (files.length) { event.preventDefault(); void addPendingFiles(files); }
              }}
              onDragOver={(event: DragEvent<HTMLTextAreaElement>) => {
                if (Array.from(event.dataTransfer.files).some(file => file.type.startsWith("image/"))) event.preventDefault();
              }}
              onDrop={(event: DragEvent<HTMLTextAreaElement>) => {
                const files = Array.from(event.dataTransfer.files).filter(file => file.type.startsWith("image/"));
                if (files.length) { event.preventDefault(); void addPendingFiles(files); }
              }}
              rows={3}
              placeholder="Escreva um comentário… Use @card ou @board para mencionar."
              className="min-w-0 flex-1 resize-y rounded border border-[#dfe1e6] p-2 text-sm"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded bg-[#e9eaed] px-2 py-1 text-xs">
              <Paperclip size={13} className="mr-1 inline" />
              Arquivo
              <input
                type="file"
                multiple
                className="sr-only"
                onChange={(event) => void addFiles(event)}
              />
            </label>
            <span className="inline-flex items-center gap-1 rounded bg-[#f0edff] px-2 py-1 text-xs text-[#403294]">
              <Sparkles size={13} />
              {(["write", "refine", "summarize", "shorten"] as const).map(
                (action) => (
                  <button
                    key={action}
                    type="button"
                    disabled={aiBusy}
                    onClick={() => void commentAi(action)}
                    className="underline disabled:opacity-50"
                  >
                    {action === "write"
                      ? "Escrever"
                      : action === "refine"
                        ? "Refinar"
                        : action === "summarize"
                          ? "Resumir"
                          : "Encurtar"}
                  </button>
                ),
              )}
              {aiBusy && <LoaderCircle size={12} className="animate-spin" />}
            </span>
            <button
              disabled={!body.trim() && !pending.length}
              className="rounded bg-[#0c66e4] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              Comentar
            </button>
          </div>
          {aiResult && (
            <div className="mt-2 rounded border border-[#c3b6f7] bg-[#f7f5ff] p-2 text-sm">
              <RichText text={aiResult} />
              <button
                type="button"
                onClick={() => {
                  setBody(aiResult);
                  setAiResult("");
                }}
                className="mt-2 rounded bg-[#6554c0] px-2 py-1 text-xs font-semibold text-white"
              >
                Usar no comentário
              </button>
            </div>
          )}
          {pending.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {pending.map((item, index) => (
                <span
                  key={item.name + index}
                  className="rounded bg-[#e9f2ff] px-2 py-1 text-xs"
                >
                  {item.mime_type?.startsWith("image/") ? <Image unoptimized src={`data:${item.mime_type};base64,${item.data || ""}`} alt={item.name} width={32} height={32} className="mr-1 inline-block h-8 w-8 rounded object-cover align-middle" /> : null}{item.name}
                  <button
                    type="button"
                    onClick={() =>
                      setPending(pending.filter((_, i) => i !== index))
                    }
                  >
                    <X size={12} className="ml-1 inline" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </form>
        <div className="mt-5 space-y-4">
          {details.comments.map((comment) => (
            <div
              key={comment.id}
              id={`comment-${comment.id}`}
              className="flex items-start gap-2"
            >
              <Avatar
                name={comment.author_name}
                url={comment.author_id === user?.id ? user?.avatar_url : null}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <strong>{comment.author_name}</strong>{" "}
                  <span className="text-xs text-[#626f86]">
                    {new Date(comment.created_at).toLocaleString("pt-BR")}
                    {comment.edited_at ? " · editado" : ""}
                  </span>
                </p>
                {editing?.id === comment.id ? (
                  <form
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (
                        await run(() =>
                          send(`/comments/${comment.id}`, "PATCH", {
                            body: editBody,
                          }),
                        )
                      ) {
                        setEditing(null);
                        await onChanged();
                      }
                    }}
                  >
                    <textarea
                      value={editBody}
                      onChange={(event) => setEditBody(event.target.value)}
                      className="mt-1 w-full rounded border p-2 text-sm"
                    />
                    <button className="mt-1 text-xs text-[#0c66e4]">
                      Salvar
                    </button>
                  </form>
                ) : (
                  <div className="mt-1 whitespace-pre-wrap rounded bg-white px-3 py-2 text-sm shadow-card">
                    <RichText text={comment.body} />
                  </div>
                )}
                {comment.attachments?.length ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {comment.attachments.map((item) =>
                      item.kind === "file" ? (
                        <div key={item.id}>
                          {item.mime_type?.startsWith("image/") ? <ImageAttachment id={item.id} name={item.name} /> : null}
                          <button onClick={() => void download(item.id, item.name)} className="rounded bg-[#e9f2ff] px-2 py-1 text-xs text-[#0c66e4]">{item.name}</button>
                        </div>
                      ) : (
                        <a
                          key={item.id}
                          href={item.url || "#"}
                          className="rounded bg-[#e9f2ff] px-2 py-1 text-xs text-[#0c66e4]"
                        >
                          {item.name}
                        </a>
                      ),
                    )}
                  </div>
                ) : null}
                <div className="mt-1 flex gap-3 text-xs text-[#626f86]">
                  <button onClick={() => void copyLink(comment)}>
                    <Copy size={12} className="mr-1 inline" />
                    Copiar link
                  </button>
                  {comment.author_id === user?.id && (
                    <>
                      <button
                        onClick={() => {
                          setEditing(comment);
                          setEditBody(comment.body);
                        }}
                      >
                        <Pencil size={12} className="mr-1 inline" />
                        Editar
                      </button>
                      <button
                        onClick={() =>
                          void run(() =>
                            send(`/comments/${comment.id}`, "DELETE"),
                          )
                        }
                        className="text-[#ae2a19]"
                      >
                        Excluir
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
