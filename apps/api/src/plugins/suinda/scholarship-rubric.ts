export type ScholarshipRubricCriterion = {
  id: string;
  label: string;
  max_points: number;
  guidance?: string;
};

export type ScholarshipCriterionScore = {
  criterion_id: string;
  score: number;
  feedback?: string;
};

export function normalizeScholarshipRubric(value: unknown): ScholarshipRubricCriterion[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error("A rubrica precisa conter até 100 critérios.");
  const criteria: ScholarshipRubricCriterion[] = [];
  const ids = new Set<string>();
  let points = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Cada critério da rubrica precisa ser um objeto.");
    const item = entry as Record<string, unknown>;
    if (Object.keys(item).some((key) => !["id", "label", "max_points", "guidance"].includes(key)))
      throw new Error("A rubrica contém campos não reconhecidos.");
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    const maxPoints = item.max_points;
    const guidance = item.guidance;
    if (!/^[a-z][a-z0-9_-]{1,39}$/.test(id) || ids.has(id)) throw new Error("Cada critério precisa de um identificador único válido.");
    if (!label || label.length > 160) throw new Error("Cada critério precisa de um nome de até 160 caracteres.");
    if (!Number.isInteger(maxPoints) || Number(maxPoints) < 1 || Number(maxPoints) > 1000)
      throw new Error("A pontuação máxima de cada critério deve ser um inteiro entre 1 e 1000.");
    if (guidance !== undefined && (typeof guidance !== "string" || guidance.length > 1000))
      throw new Error("A orientação de cada critério pode ter até 1000 caracteres.");
    ids.add(id);
    points += Number(maxPoints);
    criteria.push({ id, label, max_points: Number(maxPoints), ...(typeof guidance === "string" && guidance.trim() ? { guidance: guidance.trim() } : {}) });
  }
  if (criteria.length && points !== 1000) throw new Error("A soma das pontuações máximas da rubrica deve ser exatamente 1000.");
  return criteria;
}

export function scoreScholarshipRubric(
  criteriaValue: unknown,
  scoresValue: unknown,
): { score: number; criterion_scores: ScholarshipCriterionScore[] } {
  const criteria = normalizeScholarshipRubric(criteriaValue);
  if (!criteria.length) throw new Error("A candidatura não possui uma rubrica fixada.");
  if (!Array.isArray(scoresValue) || scoresValue.length !== criteria.length)
    throw new Error("Informe uma pontuação para cada critério da rubrica.");
  const submitted = new Map<string, ScholarshipCriterionScore>();
  for (const entry of scoresValue) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Pontuação de critério inválida.");
    const item = entry as Record<string, unknown>;
    if (Object.keys(item).some((key) => !["criterion_id", "score", "feedback"].includes(key)))
      throw new Error("A pontuação de critério contém campos não reconhecidos.");
    const criterionId = typeof item.criterion_id === "string" ? item.criterion_id : "";
    const criterion = criteria.find((candidate) => candidate.id === criterionId);
    if (!criterion || submitted.has(criterionId)) throw new Error("A lista contém critério desconhecido ou repetido.");
    if (!Number.isInteger(item.score) || Number(item.score) < 0 || Number(item.score) > criterion.max_points)
      throw new Error(`A pontuação de “${criterion.label}” deve ficar entre 0 e ${criterion.max_points}.`);
    if (item.feedback !== undefined && (typeof item.feedback !== "string" || item.feedback.length > 4000))
      throw new Error("O comentário de cada critério pode ter até 4000 caracteres.");
    submitted.set(criterionId, { criterion_id: criterionId, score: Number(item.score),
      ...(typeof item.feedback === "string" && item.feedback.trim() ? { feedback: item.feedback.trim() } : {}) });
  }
  const normalized = criteria.map((criterion) => {
    const result = submitted.get(criterion.id);
    if (!result) throw new Error("Informe uma pontuação para cada critério da rubrica.");
    return result;
  });
  return { score: normalized.reduce((total, item) => total + item.score, 0), criterion_scores: normalized };
}
