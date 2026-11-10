import assert from "node:assert/strict";
import test from "node:test";
import { createFinancialLedgerCsv } from "./financial-ledger-export";

test("exports reconciliation rows with a stable localized header and UTF-8 BOM", () => {
  const csv = createFinancialLedgerCsv([{
    entry_type: "payment", entry_id: "entry-1", workspace_name: "Instituição", unit_name: "Polo Recife",
    course_title: "Formação", cohort_code: "2026-A", enrollment_reference: "enrollment-1",
    occurred_at: "2026-10-24T12:00:00.000Z", currency: "BRL", amount: "120.50", nature: "cash_receipt",
    payment_method: "pix", external_reference: "TX-123", state: "recorded",
  }]);

  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"Tipo";"ID do lançamento";"Workspace"/);
  assert.match(csv, /"payment";"entry-1";"Instituição";"Polo Recife"/);
  assert.match(csv, /"BRL";"120\.50";"cash_receipt"/);
});

test("quotes delimited values and neutralizes spreadsheet formulas", () => {
  const csv = createFinancialLedgerCsv([{
    entry_type: "payment", entry_id: "=HYPERLINK(\"https://invalid\")", workspace_name: "A;B", unit_name: "Polo",
    course_title: "Curso", cohort_code: "A", enrollment_reference: "ref", occurred_at: "2026-10-24",
    currency: "BRL", amount: "1", nature: "cash_receipt", payment_method: "pix",
    external_reference: "@SUM(1,1)", state: "recorded",
  }]);

  assert.match(csv, /"'=HYPERLINK\(""https:\/\/invalid""\)"/);
  assert.match(csv, /"A;B"/);
  assert.match(csv, /"'@SUM\(1,1\)"/);
});
