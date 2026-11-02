import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { contrastRatio } from "./suinda-contrast";

const root = dirname(fileURLToPath(import.meta.url));
const sources = [
  "../plugins/suinda/SuindaAffiliates.tsx",
  "../plugins/suinda/SuindaWhatsAppSettings.tsx",
  "../plugins/suinda/PaymentReviewQueue.tsx",
  "../plugins/suinda/PaymentProviderSettings.tsx",
  "../app/suinda/corporate/page.tsx",
];

test("WCAG contrast helper validates the corrected Suindá dark control boundary token", () => {
  assert.throws(() => contrastRatio("#fff", "#000000"), /six-digit RGB/);
  assert.ok(contrastRatio("#ffffff", "#000000") >= 21);
  assert.ok(contrastRatio("#80909d", "#1d2125") >= 3, "effective border token against dark input fill");
  assert.ok(contrastRatio("#80909d", "#38414a") >= 3, "effective border token against dark panel surface");
  assert.ok(contrastRatio("#80909d", "#2c333a") >= 3, "effective border token against card surface");
  assert.ok(contrastRatio("#3b4754", "#1d2125") < 3,
    "regression baseline: previous border token failed the 1.4.11 3:1 threshold");
});

test("Suindá dark input placeholders meet WCAG AA contrast for normal text", () => {
  let checked = 0;
  for (const sourcePath of sources) {
    const source = readFileSync(join(root, sourcePath), "utf8");
    const pairs = source.matchAll(/bg-\[#([\da-f]{6})\][\s\S]{0,300}?placeholder:text-\[#([\da-f]{6})\]/gi);
    for (const [, background, placeholder] of pairs) {
      const ratio = contrastRatio(`#${placeholder}`, `#${background}`);
      assert.ok(ratio >= 4.5, `${sourcePath}: placeholder #${placeholder} on #${background} has contrast ${ratio.toFixed(2)}:1`);
      checked += 1;
    }
  }
  assert.equal(checked, sources.length, "each known Suindá form surface must be checked");
});

test("Suindá ERP delivery history secondary text meets WCAG AA on its dark panel", () => {
  const source = readFileSync(join(root, "../plugins/suinda/ErpDeliveryPanel.tsx"), "utf8");
  assert.match(source, /Histórico de lotes ERP[\s\S]*?bg-\[#23292f\]/);
  assert.ok(contrastRatio("#9fadbc", "#2c333a") >= 4.5);
  const tableBodyStart = source.indexOf('<tbody className="divide-y divide-white/10">');
  const tableBodyEnd = source.indexOf("</tbody>", tableBodyStart);
  assert.ok(tableBodyStart >= 0 && tableBodyEnd > tableBodyStart);
  const tableBody = source.slice(tableBodyStart, tableBodyEnd);
  assert.doesNotMatch(tableBody, /text-\[#8996a3\]/);
  assert.equal((tableBody.match(/text-\[#9fadbc\]/g) || []).length, 3);
});

test("Suindá dark review labels and integration token hints meet WCAG AA", () => {
  for (const sourcePath of [
    "../plugins/suinda/PaymentReviewQueue.tsx",
    "../plugins/suinda/CrmSyncPanel.tsx",
    "../plugins/suinda/ErpDeliveryPanel.tsx",
  ]) {
    const source = readFileSync(join(root, sourcePath), "utf8");
    assert.match(source, /text-\[#9fadbc\]/, `${sourcePath}: secondary labels use the AA foreground token`);
    assert.doesNotMatch(source, /text-\[#8996a[34]\]/, `${sourcePath}: remove the low-contrast muted foreground`);
  }
  assert.ok(contrastRatio("#9fadbc", "#2c333a") >= 4.5);
});

test("Suindá overflow tables and long result lists can receive keyboard focus", () => {
  for (const sourcePath of [
    "../plugins/suinda/ErpDeliveryPanel.tsx",
    "../plugins/suinda/SuindaFinancialReconciliation.tsx",
    "../app/suinda/teacher-dashboard.tsx",
    "../app/suinda/learning/[id]/page.tsx",
    "../app/suinda/messages/[enrollmentId]/page.tsx",
  ]) {
    const source = readFileSync(join(root, sourcePath), "utf8");
    assert.match(source, /(?:role="(?:region|log)" aria-label=.*?tabIndex=\{0\}|tabIndex=\{0\} aria-label=.*?overflow-y-auto)/,
      `${sourcePath}: scrollable content should have a keyboard entry point and accessible name`);
    assert.match(source, /focus-visible:outline/, `${sourcePath}: focus should be visible`);
  }
});

test("Suindá report table regions have distinct screen-reader names", () => {
  const source = readFileSync(join(root, "../app/suinda/reports/page.tsx"), "utf8");
  const names = Array.from(source.matchAll(/role="region" aria-label="([^"]+)" tabIndex=\{0\}/g), (match) => match[1]!);
  assert.ok(names.length >= 10, "all report tables should expose named regions");
  assert.equal(new Set(names).size, names.length, "report table region names should be unique");
  assert.doesNotMatch(source, /aria-label="Tabela horizontal do relatório"/);
});
