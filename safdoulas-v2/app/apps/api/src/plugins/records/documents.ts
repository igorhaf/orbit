import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { invalid } from "./rules";

export function decodeDocument(base64: unknown, mime: unknown, name: unknown) {
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
    "text/plain": (buffer) =>
      !buffer.includes(0) &&
      Buffer.from(buffer.toString("utf8"), "utf8").equals(buffer),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (
      buffer,
    ) => buffer.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (
      buffer,
    ) => buffer.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])),
  };
  if (typeof mime !== "string" || !signatures[mime]?.(data))
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
  async scan(data: Buffer): Promise<"clean" | "not_configured"> {
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
