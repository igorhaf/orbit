/** Quantitative screening supports the accredited reviewers; it never grants accreditation. */
type Payload = Record<string, unknown>;
type Rule = { code: string; label: string; minimum?: number; maximum?: number; unit: string; source_reference?: string };
type TeamMember = { function?: string; doula?: boolean; primary_professional_area?: string; doula_experience_years?: number };
export type RequirementCheck = Rule & { value: number | null; status: "met" | "attention" | "missing"; explanation: string };

const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const share = (part: number, total: number) => total > 0 ? part / total * 100 : null;

export async function checkCourseRequirements(course: Payload, ruleset: Payload, resolve: (id: string, revision: number) => Promise<Payload | null>, curriculum?: Payload): Promise<RequirementCheck[]> {
  const members: TeamMember[] = [];
  const refs = Array.isArray(course.team_member_refs) ? course.team_member_refs as Array<{ record_id: string; revision: number }> : [];
  let teamComplete = refs.length > 0;
  for (const ref of refs) {
    const member = await resolve(ref.record_id, ref.revision);
    if (!member) teamComplete = false;
    else members.push(member);
  }
  const coordinators = members.filter((item) => item.function === "pedagogical_coordinator");
  const teachers = members.filter((item) => item.function === "teacher");
  const clinical = new Set(["medicine", "nursing", "obstetrics"]);
  const qualifyingDoulas = (team: TeamMember[]) => team.filter((person) => person.doula === true && !clinical.has(String(person.primary_professional_area))).length;
  const experience = (team: TeamMember[]) => !team.length || team.some((person) => number(person.doula_experience_years) === null)
    ? null : Math.min(...team.map((person) => Number(person.doula_experience_years)));
  const activities = Array.isArray(curriculum?.modules)
    ? (curriculum.modules as Array<{ activities?: Array<{ hours?: number; modality?: string; activity_type?: string }> }>).flatMap((item) => item.activities || []) : [];
  const completeActivities = activities.length > 0 && activities.every((item) => number(item.hours) !== null);
  const total = completeActivities ? activities.reduce((sum, item) => sum + Number(item.hours), 0) : 0;
  const entry = course.entry_requirements as Payload | undefined;
  const values: Record<string, number | null> = {
    minimum_total_hours: number(curriculum?.total_hours),
    minimum_supervised_practice_percent: completeActivities ? share(activities.filter((item) => item.activity_type === "supervised_practice").reduce((sum, item) => sum + Number(item.hours), 0), total) : null,
    minimum_live_hours_percent: completeActivities ? share(activities.filter((item) => ["in_person", "online_synchronous"].includes(String(item.modality))).reduce((sum, item) => sum + Number(item.hours), 0), total) : null,
    minimum_live_attendance_percent: number(course.minimum_live_attendance_percent),
    minimum_coordinator_doula_percent: teamComplete ? share(coordinators.filter((item) => item.doula === true).length, coordinators.length) : null,
    minimum_teacher_doula_percent: teamComplete && teachers.every((item) => typeof item.primary_professional_area === "string") ? share(qualifyingDoulas(teachers), teachers.length) : null,
    minimum_coordinator_experience_years: teamComplete ? experience(coordinators.filter((item) => item.doula === true)) : null,
    minimum_teacher_experience_years: teamComplete ? experience(teachers.filter((item) => item.doula === true)) : null,
    minimum_entry_age: number(entry?.minimum_age),
  };
  const rules = Array.isArray(ruleset.hour_parameters) ? ruleset.hour_parameters as Rule[] : [];
  return rules.map((rule) => {
    const value = values[rule.code] ?? null;
    const known = Object.hasOwn(values, rule.code);
    const met = value !== null && (rule.minimum === undefined || value + 0.000001 >= rule.minimum) && (rule.maximum === undefined || value - 0.000001 <= rule.maximum);
    return { ...rule, value, status: value === null ? "missing" : met ? "met" : "attention",
      explanation: !known ? "Parâmetro exige conferência qualitativa ou não possui cálculo automático configurado."
        : value === null ? "Faltam dados versionados para calcular este requisito; confira as evidências."
        : met ? "Valor declarado atende ao intervalo configurado; a evidência ainda depende de análise humana."
        : "O valor calculado está fora do intervalo do edital; cabe análise e eventual diligência, sem indeferimento automático." };
  });
}
