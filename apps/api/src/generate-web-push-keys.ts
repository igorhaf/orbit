import { chmod, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import webpush from "web-push";

function parseArgs(args: string[]) {
  let envFile: string | undefined;
  let subject: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--config-path") envFile = args[++index];
    else if (arg === "--subject") subject = args[++index];
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  if (!envFile) throw new Error("Informe --config-path com o caminho do arquivo de ambiente da API.");
  if (!subject || !(subject.startsWith("mailto:") || /^https:\/\//i.test(subject))) {
    throw new Error("Informe --subject com um contato público mailto: ou URL HTTPS.");
  }
  if (subject.startsWith("mailto:") && !/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(subject)) {
    throw new Error("O subject mailto: precisa conter um endereço de contato válido.");
  }
  if (/^https:\/\//i.test(subject)) {
    try {
      if (new URL(subject).protocol !== "https:") throw new Error();
    } catch {
      throw new Error("O subject HTTPS não é uma URL válida.");
    }
  }
  return { envFile: resolve(envFile), subject };
}

function setEnvValue(contents: string, key: string, value: string) {
  const lines = contents.split(/(?<=\n)/);
  const matcher = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
  const indexes = lines.flatMap((line, index) => matcher.test(line) ? [index] : []);
  if (indexes.length > 1) throw new Error(`O arquivo contém mais de uma definição para ${key}.`);
  if (indexes.length === 1) {
    const index = indexes[0];
    if (lines[index].slice(lines[index].indexOf("=") + 1).trim()) {
      throw new Error(`${key} já está configurada; nenhuma alteração foi feita.`);
    }
    lines[index] = `${key}=${value}${lines[index].endsWith("\n") ? "\n" : ""}`;
    return lines.join("");
  }
  const separator = contents.length && !contents.endsWith("\n") ? "\n" : "";
  return `${contents}${separator}${key}=${value}\n`;
}

async function main() {
  const { envFile, subject } = parseArgs(process.argv.slice(2));
  let info;
  try {
    info = await lstat(envFile);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("O arquivo de ambiente precisa ser um arquivo regular, sem link simbólico.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const original = info ? await readFile(envFile, "utf8") : "";
  const keys = webpush.generateVAPIDKeys();
  let updated = original;
  updated = setEnvValue(updated, "WEB_PUSH_VAPID_PUBLIC_KEY", keys.publicKey);
  updated = setEnvValue(updated, "WEB_PUSH_VAPID_PRIVATE_KEY", keys.privateKey);
  updated = setEnvValue(updated, "WEB_PUSH_VAPID_SUBJECT", subject);

  const tempPath = `${envFile}.vapid-${process.pid}-${Date.now()}.tmp`;
  let handle;
  try {
    handle = await open(tempPath, "wx", 0o600);
    await handle.writeFile(updated, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(tempPath, 0o600);
    if (info) {
      const current = await readFile(envFile, "utf8");
      if (current !== original) throw new Error("O arquivo mudou durante a geração; nenhuma chave foi aplicada.");
    }
    await rename(tempPath, envFile);
    process.stdout.write(`Chaves VAPID gravadas com permissão restrita em ${envFile}. Reinicie a API para ativar Web Push.\n`);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(tempPath).catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Falha ao gerar chaves VAPID."}\n`);
  process.exitCode = 1;
});
