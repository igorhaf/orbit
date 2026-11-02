import JSZip from "jszip";
import { posix as path } from "node:path";

export type CsvRow = { line: number; values: string[] };

function detectDelimiter(source: string) {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"' && source[index + 1] === '"' && quoted) { index += 1; continue; }
    if (character === '"') quoted = !quoted;
    else if (!quoted && (character === "\r" || character === "\n")) break;
    else if (!quoted && character === ",") commas += 1;
    else if (!quoted && character === ";") semicolons += 1;
  }
  return semicolons > commas ? ";" : ",";
}

export function parseCsvRecords(source: string): CsvRow[] {
  if (typeof source !== "string" || Buffer.byteLength(source, "utf8") > 1_000_000)
    throw new Error("O arquivo CSV excede o limite de 1 MB.");
  const records: CsvRow[] = [];
  let values: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let line = 1;
  let recordLine = 1;
  const delimiter = detectDelimiter(source);
  const finishField = () => { values.push(field.trim()); field = ""; closedQuote = false; };
  const finishRecord = () => {
    finishField();
    if (values.some((value) => value !== "")) records.push({ line: recordLine, values });
    values = [];
    recordLine = line + 1;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') { quoted = false; closedQuote = true; }
      else { field += character; if (character === "\n") line += 1; }
      continue;
    }
    if (closedQuote && character !== delimiter && character !== "\r" && character !== "\n" && !/\s/.test(character))
      throw new Error(`CSV inválido na linha ${line}: conteúdo após aspas de fechamento.`);
    if (character === '"') {
      if (field.trim() !== "") throw new Error(`CSV inválido na linha ${line}: aspas fora do início do campo.`);
      field = "";
      quoted = true;
    } else if (character === delimiter) finishField();
    else if (character === "\r" || character === "\n") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      finishRecord();
      line += 1;
      recordLine = line;
    } else if (!closedQuote) field += character;
  }
  if (quoted) throw new Error(`CSV inválido na linha ${recordLine}: aspas não foram fechadas.`);
  if (field !== "" || values.length > 0) finishRecord();
  return records;
}

function enrollmentRows(records: CsvRow[]): Array<{ line: number; email: string; name?: string; issue?: string }> {
  if (!records.length) throw new Error("O CSV está vazio.");
  const headerValues = records[0].values;
  const headers = Array.from({ length: headerValues.length }, (_, index) => String(headerValues[index] || "").replace(index === 0 ? /^\uFEFF/ : /$^/, "").trim().toLowerCase());
  const emailIndex = headers.indexOf("email");
  const nameIndex = headers.findIndex((header) => header === "name" || header === "nome");
  if (emailIndex < 0 || headers.some((header) => !["email", "name", "nome"].includes(header))
    || new Set(headers.filter(Boolean).map((header) => header === "nome" ? "name" : header)).size !== headers.filter(Boolean).length
    || headers.filter(Boolean).length !== headers.length)
    throw new Error("A coluna obrigatória `email` precisa estar presente. Use `name` ou `nome` opcionalmente para convidar contas novas.");
  if (records.length < 2) throw new Error("O CSV precisa conter pelo menos um aluno após o cabeçalho.");
  if (records.length - 1 > 1000) throw new Error("O CSV pode conter no máximo 1.000 alunos por operação.");
  const seen = new Set<string>();
  return records.slice(1).map((record) => {
    const email = (record.values[emailIndex] || "").trim().toLowerCase();
    const name = nameIndex >= 0 ? (record.values[nameIndex] || "").trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320)
      return { line: record.line, email, ...(name ? { name } : {}), issue: "Informe um endereço de e-mail válido." };
    if (name.length > 300) return { line: record.line, email, issue: "O nome não pode exceder 300 caracteres." };
    if (seen.has(email)) return { line: record.line, email, ...(name ? { name } : {}), issue: "Este e-mail aparece mais de uma vez no arquivo." };
    seen.add(email);
    return { line: record.line, email, ...(name ? { name } : {}) };
  });
}

export function parseEnrollmentCsv(source: string): Array<{ line: number; email: string; name?: string; issue?: string }> {
  return enrollmentRows(parseCsvRecords(source));
}

function decodeXml(value: string) {
  return value.replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function xmlAttribute(attributes: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attributes.match(new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`));
  return match ? decodeXml(match[1]) : "";
}

export async function parseEnrollmentXlsx(source: Buffer): Promise<Array<{ line: number; email: string; name?: string; issue?: string }>> {
  if (!Buffer.isBuffer(source) || source.length < 4 || source.length > 2_000_000)
    throw new Error("A planilha XLSX deve ter até 2 MB.");
  let archive: JSZip;
  try { archive = await JSZip.loadAsync(source, { checkCRC32: false }); }
  catch { throw new Error("Não foi possível abrir a planilha XLSX. Verifique se o arquivo está íntegro."); }
  const entries = Object.values(archive.files);
  const uncompressedSize = entries.reduce((sum, entry) => sum + Number((entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0), 0);
  if (entries.length > 200 || uncompressedSize > 10_000_000) throw new Error("A planilha excede os limites de segurança.");
  const workbookXml = await archive.file("xl/workbook.xml")?.async("string");
  const relationshipsXml = await archive.file("xl/_rels/workbook.xml.rels")?.async("string");
  const firstSheet = workbookXml?.match(/<sheet\b([^>]*)\/?\s*>/)?.[1];
  const relationshipId = firstSheet ? xmlAttribute(firstSheet, "r:id") : "";
  const relationship = relationshipId && relationshipsXml
    ? [...relationshipsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].map(([, attributes]) => attributes)
      .find((attributes) => xmlAttribute(attributes, "Id") === relationshipId)
    : undefined;
  const target = relationship ? xmlAttribute(relationship, "Target") : "";
  const resolvedTarget = target.startsWith("/") ? target.slice(1) : path.normalize(path.join("xl", target));
  const sheetPath = resolvedTarget && archive.files[resolvedTarget] ? resolvedTarget
    : Object.keys(archive.files).filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry)).sort((a, b) =>
      Number(a.match(/sheet(\d+)/i)?.[1] || 0) - Number(b.match(/sheet(\d+)/i)?.[1] || 0))[0];
  if (!sheetPath) throw new Error("A planilha não contém uma aba de dados.");
  const sheetFile = archive.file(sheetPath);
  if (!sheetFile) throw new Error("A primeira aba da planilha não foi encontrada.");
  const sheet = await sheetFile.async("string");
  const sharedFile = archive.file("xl/sharedStrings.xml");
  const sharedXml = sharedFile ? await sharedFile.async("string") : "";
  const sharedStrings = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(([, item]) =>
    [...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(([, text]) => decodeXml(text)).join(""));
  const records: CsvRow[] = [];
  for (const [, rowAttributes, rowContent] of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const line = Number(xmlAttribute(rowAttributes, "r")) || records.length + 1;
    const values: string[] = [];
    for (const [, cellAttributes, cellContent] of rowContent.matchAll(/<c\b([^>]*?)(?:\s*\/\s*>|>([\s\S]*?)<\/c>)/g)) {
      const reference = xmlAttribute(cellAttributes, "r");
      const columnLetters = reference.match(/^[A-Z]+/i)?.[0] || "A";
      let column = 0;
      for (const letter of columnLetters.toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
      column -= 1;
      const type = xmlAttribute(cellAttributes, "t");
      const rawValue = cellContent.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
      const inlineText = [...cellContent.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(([, text]) => decodeXml(text)).join("");
      const text = type === "s" && rawValue !== undefined ? sharedStrings[Number(rawValue)] || ""
        : type === "inlineStr" ? inlineText : rawValue === undefined ? inlineText : decodeXml(rawValue);
      if (column >= 0 && column < 32) values[column] = text.trim();
    }
    if (values.some((value) => value !== undefined && value !== "")) records.push({ line, values });
  }
  if (!records.length) throw new Error("A planilha está vazia.");
  return enrollmentRows(records);
}
