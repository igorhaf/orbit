import assert from "node:assert/strict";
import test from "node:test";
import { parseFinancialStatementCsv } from "./financial-reconciliation-csv";

test("preserves the original four-column CSV contract", () => {
  assert.deepEqual(parseFinancialStatementCsv("reference,amount,currency,date\ntx-1,-10.5,brl,2025-01-02"), [
    { line: 2, reference: "tx-1", amount: "-10.50", currency: "BRL", occurred_on: "2025-01-02", nature: "payment", settlement_reference: null },
  ]);
});

test("accepts every settlement nature and localized header aliases", () => {
  const rows = parseFinancialStatementCsv("referência;valor;moeda;data;tipo;id_liquidacao\np1;10,00;brl;02/01/2025;payment;l1\np2;10,00;brl;02/01/2025;fee;l2\np3;10,00;brl;02/01/2025;refund;l3\np4;10,00;brl;02/01/2025;chargeback;l4\np5;10,00;brl;02/01/2025;net_settlement;l5");
  assert.deepEqual(rows.map((row) => [row.nature, row.settlement_reference]), [
    ["payment", "l1"], ["fee", "l2"], ["refund", "l3"], ["chargeback", "l4"], ["net_settlement", "l5"],
  ]);
  assert.equal(rows[0]?.amount, "10.00");
  assert.equal(rows[0]?.occurred_on, "2025-01-02");
});

test("accepts English settlement aliases and rejects invalid optional columns and values", () => {
  assert.equal(parseFinancialStatementCsv("reference,amount,currency,date,nature,settlement_id\nt,1,USD,2025-01-01,payment,s1")[0]?.settlement_reference, "s1");
  assert.throws(() => parseFinancialStatementCsv("reference,amount,currency,date,nature,settlement_reference\nt,1,USD,2025-01-01,other,s1"), /natureza/);
  assert.throws(() => parseFinancialStatementCsv("reference,amount,currency,date,nature,settlement_reference\nt,1,USD,2025-01-01,fee,"), /referência de liquidação/);
  assert.throws(() => parseFinancialStatementCsv("reference,amount,currency,date,unexpected\nt,1,USD,2025-01-01,x"), /colunas/);
  assert.throws(() => parseFinancialStatementCsv("reference,amount,currency,date,nature\nt,1,USD,2025-01-01,payment"), /referência de liquidação/);
});

test("retains date, amount and currency validation", () => {
  assert.throws(() => parseFinancialStatementCsv("reference,amount,currency,date\nt,0,USD,2025-01-01"), /diferente de zero/);
  assert.throws(() => parseFinancialStatementCsv("reference,amount,currency,date\nt,1000000000,USD,2025-01-01"), /não ultrapassar/);
  assert.throws(() => parseFinancialStatementCsv("reference,amount,currency,date\nt,1,US,2025-01-01"), /moeda/);
  assert.throws(() => parseFinancialStatementCsv("reference,amount,currency,date\nt,1,USD,2025-02-30"), /data real/);
});
