import { parseCsvRecords } from "./suinda/enrollment-csv";

export type ImportedAccount = { line: number; code: string; name: string; type: string; parent_code: string | null };

const accountCode = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const accountTypes: Record<string, string> = {
  asset: "asset", ativo: "asset", assets: "asset",
  liability: "liability", passivo: "liability", liabilities: "liability",
  equity: "equity", patrimonio: "equity", "patrimônio": "equity", "patrimônio líquido": "equity",
  revenue: "revenue", receita: "revenue", receitas: "revenue",
  expense: "expense", despesa: "expense", despesas: "expense",
  other: "other", outro: "other", outros: "other", "": "other",
};

function invalid(message: string): never { throw new Error(message); }
function containsControlCharacter(value: string) { return [...value].some((char) => {
  const code = char.codePointAt(0) || 0;
  return code < 0x20 || code >= 0x7f && code <= 0x9f;
}); }

/** Parse a provider-neutral chart-of-accounts CSV without storing the source file. */
export function parseFinancialAccountCatalogCsv(source: string): ImportedAccount[] {
  const records = parseCsvRecords(source);
  if (records.length < 2) invalid("O CSV precisa ter cabeçalho e ao menos uma conta.");
  if (records.length > 5001) invalid("O arquivo pode conter no máximo 5.000 contas.");
  const headers = records[0]!.values.map((value, index) => value.replace(index === 0 ? /^\uFEFF/ : /$^/, "").trim().toLocaleLowerCase("pt-BR"));
  const aliases: Record<string, string[]> = {
    code: ["code", "account_code", "codigo", "código", "conta", "codigo_conta", "código_conta"],
    name: ["name", "account_name", "nome", "descricao", "descrição", "nome_conta", "descricao_conta", "descrição_conta"],
    type: ["type", "account_type", "tipo", "natureza", "classificacao", "classificação"],
    parent: ["parent_code", "codigo_pai", "código_pai", "conta_pai"],
  };
  const indexes = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, headers.findIndex((header) => names.includes(header))])) as Record<keyof typeof aliases, number>;
  if (headers.length < 2 || headers.length > 4 || new Set(headers).size !== headers.length
    || indexes.code < 0 || indexes.name < 0 || headers.some((header) => !Object.values(aliases).some((names) => names.includes(header))))
    invalid("Use 2 a 4 colunas reconhecidas: código e nome obrigatórios; tipo e código da conta-pai opcionais.");

  const rows: ImportedAccount[] = records.slice(1).map(({ line, values }) => {
    if (values.length !== headers.length) invalid(`A linha ${line} tem quantidade de colunas diferente do cabeçalho.`);
    const code = values[indexes.code]!.trim().toUpperCase();
    const name = values[indexes.name]!.trim();
    const rawType = indexes.type < 0 ? "" : values[indexes.type]!.trim().toLocaleLowerCase("pt-BR");
    const rawParent = indexes.parent < 0 ? "" : values[indexes.parent]!.trim().toUpperCase();
    const type = accountTypes[rawType];
    if (!accountCode.test(code)) invalid(`O código da linha ${line} deve ter até 40 caracteres alfanuméricos, ponto, hífen ou sublinhado.`);
    if (!name || name.length > 200 || containsControlCharacter(name)) invalid(`O nome da linha ${line} deve ter até 200 caracteres sem caracteres de controle.`);
    if (!type) invalid(`A natureza da conta na linha ${line} não é reconhecida.`);
    if (rawParent && (!accountCode.test(rawParent) || rawParent === code)) invalid(`O código-pai da linha ${line} é inválido ou aponta para a própria conta.`);
    return { line, code, name, type, parent_code: rawParent || null };
  });
  const codes = new Set<string>();
  for (const row of rows) {
    if (codes.has(row.code)) invalid(`O código ${row.code} aparece mais de uma vez no arquivo.`);
    codes.add(row.code);
  }
  for (const row of rows) if (row.parent_code && !codes.has(row.parent_code))
    invalid(`A conta-pai ${row.parent_code} da linha ${row.line} não aparece neste plano importado.`);
  for (const row of rows) if (row.parent_code && codes.has(row.parent_code)) {
    let parent = rows.find((candidate) => candidate.code === row.parent_code);
    const visited = new Set([row.code]);
    while (parent) {
      if (visited.has(parent.code)) invalid(`A hierarquia de contas contém um ciclo na linha ${row.line}.`);
      visited.add(parent.code);
      parent = parent.parent_code ? rows.find((candidate) => candidate.code === parent!.parent_code) : undefined;
    }
  }
  return rows;
}
