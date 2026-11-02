import assert from "node:assert/strict";
import test from "node:test";
import { normalizeScholarshipRubric, scoreScholarshipRubric } from "./scholarship-rubric";

const rubric = [
  { id: "income", label: "Renda familiar", max_points: 600, guidance: "Avaliação documental pela equipe especializada." },
  { id: "dependents", label: "Pessoas dependentes", max_points: 400 },
];

test("rubrica de bolsa calcula total determinístico pela soma dos critérios fixados", () => {
  const result = scoreScholarshipRubric(rubric, [
    { criterion_id: "dependents", score: 300 },
    { criterion_id: "income", score: 500, feedback: "Documentos conferidos." },
  ]);
  assert.equal(result.score, 800);
  assert.deepEqual(result.criterion_scores.map((entry) => entry.criterion_id), ["income", "dependents"]);
});

test("rubrica de bolsa exige pesos totais de 1000 e IDs únicos", () => {
  assert.throws(() => normalizeScholarshipRubric([{ id: "one", label: "Um", max_points: 999 }]), /exatamente 1000/);
  assert.throws(() => normalizeScholarshipRubric([
    { id: "same", label: "Um", max_points: 500 }, { id: "same", label: "Dois", max_points: 500 },
  ]), /identificador único/);
});

test("revisão de rubrica rejeita critério ausente, duplicado, desconhecido e pontuação acima do máximo", () => {
  assert.throws(() => scoreScholarshipRubric(rubric, [{ criterion_id: "income", score: 500 }]), /cada critério/);
  assert.throws(() => scoreScholarshipRubric(rubric, [
    { criterion_id: "income", score: 500 }, { criterion_id: "income", score: 100 },
  ]), /desconhecido ou repetido/);
  assert.throws(() => scoreScholarshipRubric(rubric, [
    { criterion_id: "income", score: 601 }, { criterion_id: "dependents", score: 200 },
  ]), /entre 0 e 600/);
  assert.throws(() => scoreScholarshipRubric(rubric, [
    { criterion_id: "other", score: 500 }, { criterion_id: "dependents", score: 200 },
  ]), /desconhecido ou repetido/);
});
