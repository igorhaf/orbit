import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { invalid } from "./rules";

export function decodeDocument(base64: unknown, mime: unknown, name: unknown, allowedMimeTypes?: readonly string[]) {
  if (
    typeof base64 !== "string" ||
    base64.length > 11184812 ||
    !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
  )
    invalid("Arquivo base64 inválido ou maior que 8 MB.");
  const data = Buffer.from(base64, "base64");
  if (!data.length || data.length > 8388608)
    invalid("O arquivo precisa conter entre 1 byte e 8 MB.");
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 240 ||
    Array.from(name).some((char) => char.charCodeAt(0) < 32) ||
    /[/\\]/.test(name)
  )
    invalid("Nome de arquivo inválido.");
  const signatures: Record<string, (buffer: Buffer) => boolean> = {
    "application/pdf": (buffer) => buffer.subarray(0, 5).toString() === "%PDF-",
    "image/png": (buffer) =>
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/jpeg": (buffer) =>
      buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255,
    "image/webp": (buffer) => buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP",
    "image/gif": (buffer) => ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString()),
    "text/plain": (buffer) =>
      !buffer.includes(0) &&
      Buffer.from(buffer.toString("utf8"), "utf8").equals(buffer),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (
      buffer,
    ) => buffer.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (
      buffer,
    ) => buffer.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": (buffer) =>
      buffer.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])
      ) && buffer.includes(Buffer.from("ppt/presentation.xml")) && buffer.includes(Buffer.from("[Content_Types].xml")),
  };
  const allowed = allowedMimeTypes || [
    "application/pdf", "image/png", "image/jpeg", "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ];
  if (typeof mime !== "string" || !allowed.includes(mime) || !signatures[mime]?.(data))
    invalid(
      "Formato não permitido ou conteúdo incompatível com o tipo informado.",
    );
  return {
    data,
    file_name: name.trim(),
    mime_type: mime,
    size_bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

@Injectable()
export class DocumentScanner {
  private async scanClamD(data: Buffer, configuredUrl: string): Promise<"clean" | "infected"> {
    let endpoint: URL;
    try { endpoint = new URL(configuredUrl); }
    catch { return invalid("Endpoint do scanner de documentos inválido.", 503); }
    if (endpoint.protocol !== "tcp:" || !endpoint.hostname || !endpoint.port
      || endpoint.username || endpoint.password || !["", "/"].includes(endpoint.pathname) || endpoint.search || endpoint.hash)
      return invalid("Endpoint do scanner de documentos inválido.", 503);
    return new Promise<"clean" | "infected">((resolve, reject) => {
      const socket = createConnection({ host: endpoint.hostname, port: Number(endpoint.port) });
      let reply = Buffer.alloc(0);
      let settled = false;
      const finish = (error?: Error, result?: "clean" | "infected") => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error); else resolve(result || "clean");
      };
      socket.setTimeout(15000, () => finish(new Error("Timeout do scanner.")));
      socket.once("error", (error) => finish(error));
      socket.once("close", () => {
        if (!settled) finish(new Error("Scanner encerrou a conexão sem resposta."));
      });
      socket.on("data", (chunk: Buffer) => {
        reply = Buffer.concat([reply, chunk]);
        if (reply.length > 4096) return finish(new Error("Resposta excessiva do scanner."));
        const terminator = reply.indexOf(0);
        if (terminator < 0) return;
        const response = reply.subarray(0, terminator).toString("utf8").trim();
        if (/^stream: OK$/.test(response)) finish(undefined, "clean");
        else if (/^stream: .+ FOUND$/.test(response)) finish(undefined, "infected");
        else finish(new Error("Scanner não concluiu a verificação."));
      });
      socket.once("connect", () => {
        socket.write(Buffer.from("zINSTREAM\0", "ascii"));
        const maxChunk = 64 * 1024;
        for (let offset = 0; offset < data.length; offset += maxChunk) {
          const chunk = data.subarray(offset, Math.min(offset + maxChunk, data.length));
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      });
    }).catch(() => invalid("Scanner configurado indisponível ou sem resposta; envio interrompido.", 503));
  }

  async scan(data: Buffer): Promise<"clean" | "not_configured"> {
    const scannerUrl = process.env.ORBIT_DOCUMENT_SCANNER_URL;
    if (scannerUrl) {
      const result = await this.scanClamD(data, scannerUrl);
      if (result === "infected") invalid("O scanner identificou conteúdo malicioso.");
      return "clean";
    }
    const binary = process.env.ORBIT_DOCUMENT_SCANNER_BIN;
    if (!binary) return "not_configured";
    const directory = await mkdtemp(join(tmpdir(), "orbit-document-scan-"));
    const file = join(directory, "upload.bin");
    try {
      await writeFile(file, data, { flag: "wx", mode: 0o600 });
      const code = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(binary, ["--no-summary", file], {
          stdio: "ignore",
        });
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("Tempo do scanner excedido."));
        }, 15000);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("close", (value) => {
          clearTimeout(timer);
          resolve(value);
        });
      }).catch(() =>
        invalid("Scanner configurado indisponível; envio interrompido.", 503),
      );
      if (code === 1) invalid("O scanner identificou conteúdo malicioso.");
      if (code !== 0) invalid("O scanner não concluiu a verificação.", 503);
      return "clean";
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
