"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen, Clock3 } from "lucide-react";
import { api, getToken } from "@/lib/api";

type Course = {
  id: string;
  workspace_id: string;
  revision: number;
  workspace_name: string;
  institution_unit?: { title: string; city: string | null; state_code: string | null } | null;
  title: string;
  state: string;
  instructors?: string[];
  instructor_profiles?: Array<{ name: string; roles?: string[]; professional_title?: string | null; biography?: string | null; qualifications?: string | null; specialties?: string[]; website_url?: string | null }>;
  payload: {
    summary?: string;
    description?: string;
    category?: string;
    tags?: string[];
    modality?: "online" | "in_person" | "hybrid";
    format?: "open" | "cohort";
    level?: string;
    workload_hours?: number;
    objectives?: string[];
    competencies?: string[];
    skills?: string[];
    prerequisites?: string[];
    prerequisite_courses?: string[];
    required_materials?: string[];
    required_document_categories?: string[];
    application_form_fields?: ApplicationFormField[];
    price_amount?: number | null;
    currency?: string;
    installment_count?: number;
    first_payment_due_days?: number;
    installment_interval_days?: number;
    starts_on?: string;
    ends_on?: string;
  };
  related_courses?: Array<{
    id: string;
    title: string;
    workspace_name: string;
    state: string;
    payload: { summary?: string; category?: string; tags?: string[]; modality?: "online" | "in_person" | "hybrid"; workload_hours?: number };
  }>;
};
type ApplicationFormField = { id: string; label: string; type: "text" | "textarea" | "email" | "phone" | "number" | "date" | "select" | "multiselect"; required?: boolean; options?: string[]; max_length?: number };
type Cohort = {
  id: string;
  revision: number;
  title: string;
  institution_unit?: { title: string; city: string | null; state_code: string | null } | null;
  payload: {
    code: string;
    institution_unit_record_id?: string | null;
    price_amount?: number | null;
    seats_remaining: number;
    starts_at: string;
    ends_at: string;
    enrollment_opens_at?: string;
    enrollment_closes_at?: string;
    location?: string | null;
    schedule?: string[];
    required_document_categories?: string[];
  };
};
type ScholarshipProgram = { id: string; revision: number; title: string; payload: { description: string; discount_percent: number; scoring_method?: string;
  scoring_criteria?: Array<{ id: string; label: string; max_points: number; guidance?: string }>;
  terms_version?: string | null; concession_terms?: string | null; eligibility?: string[]; required_documents?: string[]; counterparty_requirements?: string[] } };

const states: Record<string, string> = {
  published: "Em breve",
  enrollment_open: "Inscrições abertas",
  in_progress: "Em andamento",
  closed: "Inscrições encerradas",
  completed: "Concluído",
};
const modalities: Record<string, string> = { online: "Online", in_person: "Presencial", hybrid: "Híbrido" };
const documentCategoryLabels: Record<string, string> = { identity: "Identificação", education: "Formação acadêmica", enrollment: "Matrícula", payment: "Financeiro", other: "Outro" };
const documentMimeTypes = "application/pdf,image/png,image/jpeg,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function fileBase64(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(binary);
  });
}
function documentMimeType(file: File) {
  if (file.type) return file.type;
  return ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", txt: "text/plain",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } as Record<string, string>)[file.name.split(".").pop()?.toLowerCase() || ""] || "";
}

function formatPrice(amountInput: number | null | undefined, currencyInput?: string) {
  const amount = Number(amountInput || 0);
  const currency = currencyInput || "BRL";
  if (amount <= 0 || !/^[A-Z]{3}$/.test(currency)) return "Gratuito";
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(amount); }
  catch { return "Consulte o investimento"; }
}
function priceLabel(course: Course) { return formatPrice(course.payload.price_amount, course.payload.currency); }

function dateLabel(value?: string) {
  if (!value) return null;
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(parsed);
}

function dateTimeLabel(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function cohortIsOpen(cohort: Cohort, now = Date.now()) {
  const opens = cohort.payload.enrollment_opens_at ? Date.parse(cohort.payload.enrollment_opens_at) : null;
  const closes = cohort.payload.enrollment_closes_at ? Date.parse(cohort.payload.enrollment_closes_at) : null;
  return (opens === null || !Number.isFinite(opens) || opens <= now) && (closes === null || !Number.isFinite(closes) || closes >= now);
}

export default function SuindaCoursePage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [enrollmentMessage, setEnrollmentMessage] = useState("");
  const [enrollmentSent, setEnrollmentSent] = useState(false);
  const [draftEnrollmentId, setDraftEnrollmentId] = useState("");
  const [creationOperationKey, setCreationOperationKey] = useState("");
  const [applicationFiles, setApplicationFiles] = useState<Record<string, File | null>>({});
  const [applicationAnswers, setApplicationAnswers] = useState<Record<string, string | string[]>>({});
  const [institutionReferral, setInstitutionReferral] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState("");
  const [cohortLoading, setCohortLoading] = useState(false);
  const [cohortError, setCohortError] = useState("");
  const [scholarshipPrograms, setScholarshipPrograms] = useState<ScholarshipProgram[]>([]);
  const [selectedScholarshipId, setSelectedScholarshipId] = useState("");
  const [scholarshipFiles, setScholarshipFiles] = useState<Record<string, File | null>>({});
  const [acceptScholarshipTerms, setAcceptScholarshipTerms] = useState(false);
  const [scholarshipSignatureName, setScholarshipSignatureName] = useState("");
  const [scholarshipApplicationSent, setScholarshipApplicationSent] = useState(false);
  const [scholarshipOperationKey, setScholarshipOperationKey] = useState("");
  const availableCohorts = cohorts.filter((cohort) => cohortIsOpen(cohort));
  const selectedCohort = availableCohorts.find((cohort) => cohort.id === selectedCohortId);
  const enrollmentPrice = Number(selectedCohort?.payload.price_amount ?? course?.payload.price_amount ?? 0);
  const requiredDocumentCategories = [...new Set([
    ...(course?.payload.required_document_categories || []),
    ...(selectedCohort?.payload.required_document_categories || []),
  ])];

  function setApplicationAnswer(fieldId: string, value: string | string[]) {
    setApplicationAnswers((current) => ({ ...current, [fieldId]: value }));
  }

  useEffect(() => {
    if (!course || course.state !== "enrollment_open" || course.payload.format !== "cohort") return;
    let active = true;
    api<Cohort[]>(`/public/suinda/courses/${encodeURIComponent(course.id)}/cohorts`)
      .then((items) => {
        if (!active) return;
        setCohorts(items);
        setSelectedCohortId((current) => items.some((item) => item.id === current) ? current : items.find(cohortIsOpen)?.id || "");
      })
      .catch((reason: unknown) => { if (active) setCohortError(reason instanceof Error ? reason.message : "Não foi possível carregar as turmas."); })
      .finally(() => { if (active) setCohortLoading(false); });
    Promise.resolve().then(() => { if (active) setCohortLoading(true); });
    return () => { active = false; };
  }, [course]);

  useEffect(() => {
    if (!course || !userId) return;
    let active = true;
    api<ScholarshipProgram[]>(`/extensions/suinda-learning/me/scholarships?courseId=${encodeURIComponent(course.id)}`)
      .then((items) => { if (active) setScholarshipPrograms(items); })
      .catch(() => { if (active) setScholarshipPrograms([]); });
    return () => { active = false; };
  }, [course, userId]);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme;
    root.dataset.theme = "dark";
    Promise.resolve().then(() => {
      try {
        const user = JSON.parse(localStorage.getItem("orbit_user") || "null") as { id?: unknown } | null;
        if (getToken() && typeof user?.id === "string") setUserId(user.id);
      } catch { setUserId(""); }
    });
    api<Course>(`/public/suinda/courses/${encodeURIComponent(id)}`)
      .then(setCourse)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Não foi possível abrir este curso."));
    return () => {
      if (previous) root.dataset.theme = previous;
      else delete root.dataset.theme;
    };
  }, [id]);

  async function enroll() {
    if (!course || !userId || enrolling || course.payload.format === "cohort" && !availableCohorts.some((cohort) => cohort.id === selectedCohortId)) return;
    const fields = course.payload.application_form_fields || [];
    const unanswered = fields.filter((field) => field.required).filter((field) => {
      const answer = applicationAnswers[field.id];
      return answer === undefined || answer === "" || Array.isArray(answer) && answer.length === 0;
    });
    if (!draftEnrollmentId && unanswered.length) {
      setEnrollmentMessage(`Preencha os campos obrigatórios: ${unanswered.map((field) => field.label).join(", ")}.`);
      return;
    }
    const requiredCategories = requiredDocumentCategories;
    const missing = requiredCategories.filter((category) => !applicationFiles[category]);
    if (!draftEnrollmentId && missing.length) {
      setEnrollmentMessage(`Selecione os documentos exigidos: ${missing.map((category) => documentCategoryLabels[category] || category).join(", ")}.`);
      return;
    }
    const scholarship = scholarshipPrograms.find((program) => program.id === selectedScholarshipId);
    const scholarshipCategories = scholarship?.payload.required_documents || [];
    const missingScholarshipDocuments = scholarshipCategories.filter((category) => !scholarshipFiles[category]);
    if (scholarship && !scholarshipApplicationSent && missingScholarshipDocuments.length) {
      setEnrollmentMessage(`Para concorrer à bolsa, selecione os documentos: ${missingScholarshipDocuments.join(", ")}.`);
      return;
    }
    if (scholarship && !scholarshipApplicationSent && !acceptScholarshipTerms) {
      setEnrollmentMessage("Aceite os termos do programa de bolsas para enviar a candidatura.");
      return;
    }
    if (scholarship && !scholarshipApplicationSent && !scholarshipSignatureName.trim()) {
      setEnrollmentMessage("Digite seu nome como aparece no perfil do Orbit para assinar os termos da bolsa.");
      return;
    }
    setEnrolling(true);
    setEnrollmentMessage("");
    setEnrollmentSent(false);
    let activeDraftId = draftEnrollmentId;
    try {
      let enrollmentId = draftEnrollmentId;
      let enrollmentRevision = 1;
      if (!enrollmentId) {
        const operationKey = creationOperationKey || crypto.randomUUID();
        setCreationOperationKey(operationKey);
        const created = await api<{ id: string; revision: number }>(`/extensions/suinda-learning/workspaces/${encodeURIComponent(course.workspace_id)}/records`, {
          method: "POST",
          body: JSON.stringify({ kind: "enrollment", title: `Inscrição · ${course.title}`, operation_key: operationKey, payload: {
            course_record_id: course.id, course_revision: course.revision, learner_user_id: userId,
            ...(institutionReferral.trim() ? { institution_referral: institutionReferral.trim() } : {}),
            ...(couponCode.trim() ? { coupon_code: couponCode.trim().toUpperCase() } : {}),
            payment_status: enrollmentPrice > 0 ? "pending" : "not_required",
            ...(fields.length ? { application_answers: Object.fromEntries(fields.flatMap((field) => {
              const answer = applicationAnswers[field.id];
              if (answer === undefined || answer === "" || Array.isArray(answer) && !answer.length) return [];
              return [[field.id, field.type === "number" ? Number(answer) : answer]];
            })) } : {}),
            ...(course.payload.format === "cohort" ? { cohort_record_id: selectedCohortId, cohort_revision: selectedCohort?.revision } : {}),
          } }),
        });
        enrollmentId = created.id;
        activeDraftId = created.id;
        enrollmentRevision = created.revision;
        setDraftEnrollmentId(created.id);
        setCreationOperationKey("");
      } else {
        const draft = await api<{ enrollment_revision: number; documents: Array<{ category: string; state: string }> }>(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/documents`);
        enrollmentRevision = draft.enrollment_revision;
        const couponUpdate = await api<{ revision: number }>(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/coupon`, {
          method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: enrollmentRevision,
            coupon_code: couponCode.trim() ? couponCode.trim().toUpperCase() : null }),
        });
        enrollmentRevision = couponUpdate.revision;
        const uploadedCategories = new Set(draft.documents.filter((document) => ["submitted", "approved"].includes(document.state)).map((document) => document.category));
        for (let index = requiredCategories.length - 1; index >= 0; index--) if (uploadedCategories.has(requiredCategories[index])) requiredCategories.splice(index, 1);
      }
      for (const category of requiredCategories) {
        const file = applicationFiles[category];
        if (!file) continue;
        await api(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/documents`, {
          method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), title: `${documentCategoryLabels[category] || category} · ${course.title}`,
            category, file_name: file.name, mime_type: documentMimeType(file), data_base64: await fileBase64(file) }),
        });
      }
      if (scholarship && !scholarshipApplicationSent) {
        const operationKey = scholarshipOperationKey || crypto.randomUUID();
        setScholarshipOperationKey(operationKey);
        const scholarshipDocuments = await Promise.all(scholarshipCategories.map(async (category) => {
          const file = scholarshipFiles[category];
          return file ? { category, file_name: file.name, mime_type: documentMimeType(file), data_base64: await fileBase64(file) } : null;
        }));
        const result = await api<{ state: string; waitlist_position?: number | null }>(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/scholarship-applications`, {
          method: "POST", body: JSON.stringify({ operation_key: operationKey, program_record_id: scholarship.id, accept_terms: true,
            signature_name: scholarshipSignatureName.trim(),
            documents: scholarshipDocuments.filter((document): document is NonNullable<typeof document> => Boolean(document)) }),
        });
        setScholarshipApplicationSent(true);
        setEnrollmentMessage(result.state === "waitlisted" ? `Candidatura à bolsa enviada para a lista de espera${result.waitlist_position ? ` (posição ${result.waitlist_position})` : ""}.` : "Candidatura à bolsa enviada para análise.");
      }
      const submitted = await api<{ discount_amount?: number; amount_due?: number; coupon_code?: string | null; discount_context?: string | null; discount_partner?: string | null }>(`/extensions/suinda-learning/me/enrollments/${encodeURIComponent(enrollmentId)}/submit`, {
        method: "POST", body: JSON.stringify({ operation_key: crypto.randomUUID(), expected_revision: enrollmentRevision }),
      });
      const discountLabel = submitted.discount_context === "institutional_agreement" ? "Convênio institucional" : submitted.discount_context === "member_discount" ? "Desconto para associado" : "Cupom";
      setEnrollmentMessage(`${scholarship ? "Sua inscrição e candidatura à bolsa foram enviadas para análise." : "Sua inscrição foi enviada para análise pela equipe acadêmica."}${submitted.discount_amount ? ` ${discountLabel}${submitted.discount_partner ? ` · ${submitted.discount_partner}` : ` ${submitted.coupon_code}`} aplicado: desconto de ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: course.payload.currency || "BRL" }).format(submitted.discount_amount)}; saldo ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: course.payload.currency || "BRL" }).format(submitted.amount_due || 0)}.` : ""}`);
      setEnrollmentSent(true);
    } catch (reason) {
      setEnrollmentMessage(activeDraftId ? `Seu rascunho foi salvo. ${reason instanceof Error ? reason.message : "Conclua o envio dos documentos na área da inscrição."}`
        : reason instanceof Error ? reason.message : "Não foi possível enviar sua inscrição.");
    } finally { setEnrolling(false); }
  }

  return (
    <main className="min-h-screen bg-[#1d2125] text-[#dee4ea]">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:py-12">
        <Link href="/suinda/catalog" className="inline-flex min-h-11 items-center gap-2 rounded-xl text-sm text-[#b6c2cf] transition hover:text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><ArrowLeft size={16} aria-hidden="true" /> Voltar ao catálogo</Link>
        {!course && !error && <p role="status" className="mt-10 text-sm text-[#9fadbc]">Carregando informações do curso…</p>}
        {error && <section role="alert" className="mt-8 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-6 text-rose-100"><h1 className="text-xl font-semibold">Curso indisponível</h1><p className="mt-2 text-sm">{error}</p><Link href="/suinda/catalog" className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg bg-white/10 px-4 text-sm font-medium hover:bg-white/15">Explorar outros cursos <ArrowRight size={15} aria-hidden="true" /></Link></section>}
        {course && <>
          <header className="relative mt-7 overflow-hidden rounded-[2rem] border border-[#3b4754] bg-[radial-gradient(ellipse_at_top_right,_rgba(34,211,238,0.18),_transparent_42%),linear-gradient(135deg,#111827,#0c1220_65%,#101a27)] p-7 sm:p-11">
            <div className="relative max-w-3xl">
              <p className="text-sm font-medium text-cyan-200">{course.workspace_name}{course.institution_unit?.title ? ` · ${course.institution_unit.title}` : ""}{course.payload.category ? ` · ${course.payload.category}` : ""}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2"><span className="rounded-full border border-cyan-100/20 bg-cyan-100/5 px-3 py-1.5 text-xs font-medium text-cyan-100">{states[course.state] || course.state}</span>{course.payload.modality && <span className="rounded-full border border-[#3b4754] bg-white/[0.04] px-3 py-1.5 text-xs text-[#b6c2cf]">{modalities[course.payload.modality] || course.payload.modality}</span>}</div>
              <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-5xl">{course.title}</h1>
              <p className="mt-4 text-base leading-7 text-[#b6c2cf]">{course.payload.summary || "Conheça a proposta e os detalhes desta formação."}</p>
              <div className="mt-7 flex flex-wrap items-center gap-3 text-sm text-[#b6c2cf]">{Number(course.payload.workload_hours) > 0 && <span className="inline-flex items-center gap-2 rounded-xl bg-black/20 px-3 py-2"><Clock3 size={15} aria-hidden="true" /> {course.payload.workload_hours} horas</span>}<span className="rounded-xl bg-black/20 px-3 py-2">{course.payload.format === "cohort" ? "Preço por turma" : priceLabel(course)}</span>{Number(course.payload.price_amount || 0) > 0 && Number(course.payload.installment_count || 1) > 1 && <span className="rounded-xl bg-black/20 px-3 py-2">Até {course.payload.installment_count} parcelas · primeira em {course.payload.first_payment_due_days || 0} dias · intervalo de {course.payload.installment_interval_days || 30} dias</span>}{course.payload.format && <span className="rounded-xl bg-black/20 px-3 py-2">{course.payload.format === "cohort" ? "Com turmas" : "Curso livre"}</span>}</div>
            </div>
          </header>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-6">
              {course.payload.description && <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-6 sm:p-8"><h2 className="text-lg font-semibold text-white">Sobre o curso</h2><p className="mt-4 whitespace-pre-line text-sm leading-7 text-[#b6c2cf]">{course.payload.description}</p></section>}
              {!!course.instructors?.length && <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-6 sm:p-8"><h2 className="text-lg font-semibold text-white">Equipe docente</h2><ul className="mt-4 grid gap-4 sm:grid-cols-2">{course.instructors.map((name) => {
                const profile = course.instructor_profiles?.find((item) => item.name === name);
                return <li key={name} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"><h3 className="font-medium text-white">{name}</h3>{profile && <>
                  {profile.professional_title && <p className="mt-1 text-xs text-cyan-100">{profile.professional_title}{profile.roles?.length ? ` · ${profile.roles.join(" / ")}` : ""}</p>}
                  {profile.biography && <p className="mt-3 whitespace-pre-line text-sm leading-6 text-[#b6c2cf]">{profile.biography}</p>}
                  {profile.qualifications && <p className="mt-3 whitespace-pre-line text-xs leading-5 text-[#9fadbc]">{profile.qualifications}</p>}
                  {!!profile.specialties?.length && <p className="mt-3 text-xs text-[#9fadbc]">Especialidades: {profile.specialties.join(" · ")}</p>}
                  {profile.website_url && <a href={profile.website_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-9 items-center text-xs font-medium text-cyan-100 underline underline-offset-4">Site profissional</a>}
                </>}</li>;
              })}</ul></section>}
              {course.payload.objectives?.length ? <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-6 sm:p-8"><h2 className="text-lg font-semibold text-white">O que você vai aprender</h2><ul className="mt-4 space-y-3">{course.payload.objectives.map((item, index) => <li key={`${index}:${item}`} className="flex gap-3 text-sm leading-6 text-[#b6c2cf]"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-cyan-300" />{item}</li>)}</ul></section> : null}
              {course.payload.competencies?.length || course.payload.skills?.length ? <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-6 sm:p-8"><h2 className="text-lg font-semibold text-white">Competências e habilidades</h2>{course.payload.competencies?.length ? <div className="mt-4"><h3 className="text-xs font-medium uppercase tracking-wide text-[#9fadbc]">Competências</h3><ul className="mt-2 flex flex-wrap gap-2">{course.payload.competencies.map((item) => <li key={item} className="rounded-lg border border-cyan-200/15 bg-cyan-200/[0.05] px-3 py-1.5 text-xs text-cyan-100">{item}</li>)}</ul></div> : null}{course.payload.skills?.length ? <div className="mt-4"><h3 className="text-xs font-medium uppercase tracking-wide text-[#9fadbc]">Habilidades</h3><ul className="mt-2 flex flex-wrap gap-2">{course.payload.skills.map((item) => <li key={item} className="rounded-lg border border-[#3b4754] bg-white/[0.03] px-3 py-1.5 text-xs text-[#b6c2cf]">{item}</li>)}</ul></div> : null}</section> : null}
              {!!course.related_courses?.length && <section aria-labelledby="suinda-related-courses" className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-6 sm:p-8"><h2 id="suinda-related-courses" className="text-lg font-semibold text-white">Cursos relacionados</h2><p className="mt-1 text-sm text-[#9fadbc]">Sugestões baseadas na categoria, nos temas e na modalidade deste curso.</p><ul className="mt-4 grid gap-3 sm:grid-cols-2">{course.related_courses.map((related) => <li key={related.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"><p className="text-[11px] text-cyan-100">{related.workspace_name}{related.payload.category ? ` · ${related.payload.category}` : ""}</p><h3 className="mt-2 font-medium text-white">{related.title}</h3>{related.payload.summary && <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#9fadbc]">{related.payload.summary}</p>}<div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[#9fadbc]">{related.payload.modality && <span>{modalities[related.payload.modality] || related.payload.modality}</span>}{Number(related.payload.workload_hours) > 0 && <span>{related.payload.modality ? "· " : ""}{related.payload.workload_hours} h</span>}</div><Link href={`/suinda/course/${encodeURIComponent(related.id)}`} className="mt-3 inline-flex min-h-9 items-center gap-2 text-xs font-medium text-cyan-100 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Ver curso <ArrowRight size={14} aria-hidden="true" /></Link></li>)}</ul></section>}
              {course.payload.prerequisites?.length ? <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-6 sm:p-8"><h2 className="text-lg font-semibold text-white">Pré-requisitos</h2><ul className="mt-4 space-y-3">{course.payload.prerequisites.map((item, index) => <li key={`${index}:${item}`} className="text-sm leading-6 text-[#b6c2cf]">{item}</li>)}</ul></section> : null}
              {course.payload.prerequisite_courses?.length ? <section aria-labelledby="suinda-prerequisite-courses" className="rounded-2xl border border-cyan-300/20 bg-[#2c333a] p-6 sm:p-8"><h2 id="suinda-prerequisite-courses" className="text-lg font-semibold text-white">Cursos que precisam estar concluídos antes da inscrição</h2><ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-[#b6c2cf]">{course.payload.prerequisite_courses.map((title, index) => <li key={`${index}:${title}`}>{title}</li>)}</ul></section> : null}
              {course.payload.required_materials?.length ? <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-6 sm:p-8"><h2 className="text-lg font-semibold text-white">Materiais necessários</h2><ul className="mt-4 space-y-3">{course.payload.required_materials.map((item, index) => <li key={`${index}:${item}`} className="text-sm leading-6 text-[#b6c2cf]">{item}</li>)}</ul></section> : null}
              {course.payload.application_form_fields?.length ? <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-6 sm:p-8"><h2 className="text-lg font-semibold text-white">Dados da inscrição</h2><p className="mt-2 text-sm leading-6 text-[#9fadbc]">As respostas são compartilhadas apenas com a equipe acadêmica responsável por esta inscrição.</p><div className="mt-5 grid gap-4 sm:grid-cols-2">{course.payload.application_form_fields.map((field) => <label key={field.id} className={`block text-sm text-[#b6c2cf] ${field.type === "textarea" || field.type === "multiselect" ? "sm:col-span-2" : ""}`}>{field.label}{field.required && <span className="ml-1 text-cyan-200" aria-label="obrigatório">*</span>}{field.type === "textarea" ? <textarea required={field.required} maxLength={field.max_length || 4000} value={String(applicationAnswers[field.id] || "")} onChange={(event) => setApplicationAnswer(field.id, event.target.value)} rows={4} className="mt-1 w-full rounded-xl border border-[#3b4754] bg-[#2c333a] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60" /> : field.type === "select" ? <select required={field.required} value={String(applicationAnswers[field.id] || "")} onChange={(event) => setApplicationAnswer(field.id, event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white outline-none focus:border-cyan-300/60"><option value="">Selecione uma opção</option>{(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select> : field.type === "multiselect" ? <select multiple required={field.required} value={Array.isArray(applicationAnswers[field.id]) ? applicationAnswers[field.id] as string[] : []} onChange={(event) => setApplicationAnswer(field.id, [...event.currentTarget.selectedOptions].map((option) => option.value))} className="mt-1 min-h-28 w-full rounded-xl border border-[#3b4754] bg-[#2c333a] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60">{(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input required={field.required} type={field.type === "phone" ? "tel" : field.type} maxLength={field.type === "number" || field.type === "date" ? undefined : field.max_length || 500} value={String(applicationAnswers[field.id] || "")} onChange={(event) => setApplicationAnswer(field.id, event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white outline-none focus:border-cyan-300/60" />}</label>)}</div></section> : null}
              {requiredDocumentCategories.length ? <section className="rounded-2xl border border-[#3b4754] bg-[#2c333a] p-6 sm:p-8"><h2 className="text-lg font-semibold text-white">Documentos para matrícula</h2><p className="mt-2 text-sm leading-6 text-[#9fadbc]">A equipe acadêmica revisará os documentos enviados após a inscrição. Os requisitos da turma selecionada são incluídos.</p><ul className="mt-4 grid gap-2 sm:grid-cols-2">{requiredDocumentCategories.map((item) => <li key={item} className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm text-[#b6c2cf]">{documentCategoryLabels[item] || item}</li>)}</ul></section> : null}
            </div>
            <aside className="h-fit rounded-2xl border border-[#3b4754] bg-[#2c333a] p-6 lg:sticky lg:top-6"><div className="flex size-11 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><BookOpen size={20} aria-hidden="true" /></div><p className="mt-5 text-xs font-medium uppercase tracking-[0.14em] text-[#9fadbc]">Investimento</p><p className="mt-1 text-2xl font-semibold text-white">{course.payload.format === "cohort" ? selectedCohort ? formatPrice(selectedCohort.payload.price_amount ?? course.payload.price_amount, course.payload.currency) : "Selecione uma turma" : priceLabel(course)}</p>{dateLabel(course.payload.starts_on) && <p className="mt-4 text-sm text-[#b6c2cf]">Início previsto: {dateLabel(course.payload.starts_on)}</p>}{dateLabel(course.payload.ends_on) && <p className="mt-1 text-sm text-[#9fadbc]">Conclusão prevista: {dateLabel(course.payload.ends_on)}</p>}
              {course.state === "enrollment_open" && (course.payload.format === "open" || availableCohorts.length > 0) ? <>
                <p className="mt-5 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-3 text-sm leading-6 text-cyan-100">{enrollmentPrice > 0 ? "As inscrições estão abertas. A equipe acadêmica informará as instruções de pagamento e confirmará a baixa manual após o recebimento." : course.payload.format === "cohort" && !selectedCohort ? "Selecione uma turma para consultar o investimento e as condições de pagamento." : "As inscrições estão abertas para esta formação gratuita."}</p>
                {course.payload.format === "cohort" && <div className="mt-4"><label htmlFor="suinda-cohort" className="mb-2 block text-sm font-medium text-[#b6c2cf]">Escolha uma turma</label><select id="suinda-cohort" value={selectedCohortId} onChange={(event) => setSelectedCohortId(event.target.value)} className="min-h-12 w-full rounded-xl border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white outline-none focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20"><option value="">Selecione uma turma</option>{availableCohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.payload.code}{cohort.institution_unit?.title ? ` · ${cohort.institution_unit.title}` : ""} · {dateTimeLabel(cohort.payload.starts_at) || "Data a confirmar"} · {cohort.payload.seats_remaining} {cohort.payload.seats_remaining === 1 ? "vaga" : "vagas"}</option>)}</select>{cohortError && <p role="alert" className="mt-2 text-xs text-rose-200">{cohortError}</p>}{!cohortLoading && !cohortError && availableCohorts.length === 0 && <p className="mt-2 text-xs text-[#9fadbc]">Não há turmas abertas para inscrição neste momento.</p>}{availableCohorts.find((cohort) => cohort.id === selectedCohortId) && <div className="mt-3 rounded-xl border border-[#3b4754] bg-white/[0.03] p-3 text-xs leading-5 text-[#b6c2cf]"><p>Período: {dateTimeLabel(availableCohorts.find((cohort) => cohort.id === selectedCohortId)!.payload.starts_at) || "A confirmar"} – {dateTimeLabel(availableCohorts.find((cohort) => cohort.id === selectedCohortId)!.payload.ends_at) || "A confirmar"}</p>{availableCohorts.find((cohort) => cohort.id === selectedCohortId)?.institution_unit?.title && <p className="mt-1">Unidade: {availableCohorts.find((cohort) => cohort.id === selectedCohortId)?.institution_unit?.title}{availableCohorts.find((cohort) => cohort.id === selectedCohortId)?.institution_unit?.city ? ` · ${availableCohorts.find((cohort) => cohort.id === selectedCohortId)?.institution_unit?.city}` : ""}</p>}{availableCohorts.find((cohort) => cohort.id === selectedCohortId)?.payload.seats_remaining === 0 && <p className="mt-1 text-amber-200">Sem vagas disponíveis; a inscrição será analisada para a lista de espera.</p>}{availableCohorts.find((cohort) => cohort.id === selectedCohortId)?.payload.location && <p className="mt-1">Local: {availableCohorts.find((cohort) => cohort.id === selectedCohortId)?.payload.location}</p>}</div>}</div>}
              <label className="mt-4 block text-xs text-[#b6c2cf]">Cupom ou código de convite (opcional)<input maxLength={40} autoComplete="off" value={couponCode} disabled={enrolling} onChange={(event) => setCouponCode(event.target.value.toUpperCase().replace(/\s/g, ""))} placeholder="EXEMPLO2026" className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm uppercase text-white placeholder:text-[#9fadbc]" /><span className="mt-1 block text-[11px] text-[#9fadbc]">O código é validado no envio da inscrição. Desconto e limite de uso são definidos pela instituição.</span></label>
              <label className="mt-4 block text-xs text-[#b6c2cf]">Instituição que indicou você (opcional)<input maxLength={180} autoComplete="organization" value={institutionReferral} disabled={enrolling || Boolean(draftEnrollmentId)} onChange={(event) => setInstitutionReferral(event.target.value)} placeholder="Nome da escola, empresa ou instituição" className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white placeholder:text-[#9fadbc]" /><span className="mt-1 block text-[11px] text-[#9fadbc]">Informação declarada pelo candidato, sujeita à conferência da equipe acadêmica.</span></label>
              {requiredDocumentCategories.length ? <fieldset className="mt-4 rounded-xl border border-[#3b4754] bg-white/[0.03] p-3"><legend className="px-1 text-sm font-semibold text-white">Documentos para inscrição</legend><p className="text-xs leading-5 text-[#9fadbc]">Envie os documentos exigidos pelo curso e pela turma. Você pode salvar o rascunho e concluir depois.</p><ul className="mt-3 space-y-2">{requiredDocumentCategories.map((category) => <li key={category} className="rounded-lg border border-white/[0.08] p-2"><label className="block text-xs font-medium text-[#b6c2cf]">{documentCategoryLabels[category] || category}<input type="file" required={!draftEnrollmentId} accept={documentMimeTypes} disabled={enrolling} onChange={(event) => setApplicationFiles((current) => ({ ...current, [category]: event.target.files?.[0] || null }))} className="mt-2 block w-full text-[11px] text-[#9fadbc] file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1.5 file:text-xs file:text-white" /></label></li>)}</ul><p className="mt-2 text-[11px] text-[#9fadbc]">PDF, PNG, JPEG, texto, DOCX ou XLSX; até 8 MB por arquivo.</p></fieldset> : null}
                {!!scholarshipPrograms.length && <fieldset className="mt-4 rounded-xl border border-violet-200/20 bg-violet-200/[0.04] p-3"><legend className="px-1 text-sm font-semibold text-violet-100">Programa de bolsas</legend><p className="text-xs leading-5 text-[#9fadbc]">Opcional: candidate-se a uma bolsa e aguarde a análise da coordenação.</p><label htmlFor="suinda-scholarship" className="mt-3 block text-xs font-medium text-[#b6c2cf]">Programa<select id="suinda-scholarship" value={selectedScholarshipId} disabled={enrolling || scholarshipApplicationSent} onChange={(event) => { setSelectedScholarshipId(event.target.value); setScholarshipFiles({}); setAcceptScholarshipTerms(false); setScholarshipApplicationSent(false); setScholarshipOperationKey(""); }} className="mt-1 min-h-11 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white"><option value="">Não vou me candidatar</option>{scholarshipPrograms.map((program) => <option key={program.id} value={program.id}>{program.title} · {program.payload.discount_percent}%</option>)}</select></label>{scholarshipPrograms.find((program) => program.id === selectedScholarshipId) && <div className="mt-3 space-y-2 text-xs leading-5 text-[#b6c2cf]">{scholarshipPrograms.find((program) => program.id === selectedScholarshipId)?.payload.description && <p>{scholarshipPrograms.find((program) => program.id === selectedScholarshipId)?.payload.description}</p>}{scholarshipPrograms.find((program) => program.id === selectedScholarshipId)?.payload.scoring_method === "weighted_v1" && <div className="rounded-lg border border-violet-200/10 bg-violet-200/[0.03] p-2"><p className="font-medium text-violet-100">Critérios de pontuação · total até 1.000</p><ul className="mt-1 space-y-1">{(scholarshipPrograms.find((program) => program.id === selectedScholarshipId)?.payload.scoring_criteria || []).map((criterion) => <li key={criterion.id}>{criterion.label}: até {criterion.max_points} pontos{criterion.guidance ? ` · ${criterion.guidance}` : ""}</li>)}</ul></div>}{!!scholarshipPrograms.find((program) => program.id === selectedScholarshipId)?.payload.eligibility?.length && <p>Elegibilidade: {scholarshipPrograms.find((program) => program.id === selectedScholarshipId)?.payload.eligibility?.join(" · ")}</p>}{!!scholarshipPrograms.find((program) => program.id === selectedScholarshipId)?.payload.counterparty_requirements?.length && <p>Contrapartidas: {scholarshipPrograms.find((program) => program.id === selectedScholarshipId)?.payload.counterparty_requirements?.join(" · ")}</p>}{scholarshipPrograms.find((program) => program.id === selectedScholarshipId)?.payload.concession_terms && <details className="rounded-lg border border-[#3b4754] p-2"><summary className="cursor-pointer font-medium text-violet-100">Termos de concessão · {scholarshipPrograms.find((program) => program.id === selectedScholarshipId)?.payload.terms_version}</summary><p className="mt-2 whitespace-pre-line">{scholarshipPrograms.find((program) => program.id === selectedScholarshipId)?.payload.concession_terms}</p></details>}
                  {(scholarshipPrograms.find((program) => program.id === selectedScholarshipId)?.payload.required_documents || []).map((category) => <label key={category} className="block rounded-lg border border-white/[0.08] p-2 text-xs">Documento exigido: {category}<input type="file" accept={documentMimeTypes} disabled={enrolling || scholarshipApplicationSent} onChange={(event) => setScholarshipFiles((current) => ({ ...current, [category]: event.target.files?.[0] || null }))} className="mt-2 block w-full text-[11px] text-[#9fadbc] file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1.5 file:text-xs file:text-white" /></label>)}
                  <p className="text-[11px] text-[#9fadbc]">PDF, PNG, JPEG, texto, DOCX ou XLSX; até 8 MB no total.</p><label className="block text-xs text-[#b6c2cf]">Nome completo para assinatura<input required maxLength={240} autoComplete="name" value={scholarshipSignatureName} disabled={enrolling || scholarshipApplicationSent} onChange={(event) => setScholarshipSignatureName(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[#3b4754] bg-[#2c333a] px-3 text-sm text-white" /><span className="mt-1 block text-[11px] text-[#9fadbc]">Digite o nome exatamente como aparece no seu perfil do Orbit.</span></label><label className="flex items-start gap-2 pt-1 text-xs leading-5 text-[#b6c2cf]"><input type="checkbox" checked={acceptScholarshipTerms} disabled={enrolling || scholarshipApplicationSent} onChange={(event) => setAcceptScholarshipTerms(event.target.checked)} className="mt-1 accent-violet-300" />Confirmo que li os termos de concessão, aceito seu conteúdo e assino eletronicamente esta versão para a candidatura.</label><p className="text-[11px] leading-5 text-[#9fadbc]">O registro vincula sua conta autenticada ao nome digitado e à versão exata dos termos. É uma assinatura eletrônica simples; não é certificado digital ICP-Brasil.</p>{scholarshipApplicationSent && <p role="status" className="text-emerald-200">Candidatura e assinatura eletrônica registradas.</p>}</div>}</fieldset>}
                {!userId ? <Link href="/" className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-200 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200">Entre para se inscrever <ArrowRight size={15} aria-hidden="true" /></Link> : <button type="button" onClick={enroll} disabled={enrolling || course.payload.format === "cohort" && !availableCohorts.some((cohort) => cohort.id === selectedCohortId)} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-200 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200">{enrolling ? "Enviando inscrição…" : "Inscrever-se"} {!enrolling && <ArrowRight size={15} aria-hidden="true" />}</button>}
                <Link href={`/suinda/subscriptions?workspaceId=${encodeURIComponent(course.workspace_id)}`} className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-cyan-200/20 px-4 text-sm font-medium text-cyan-100 transition hover:bg-cyan-200/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200">Consultar planos de assinatura</Link>
                {enrollmentMessage && <p role="status" className="mt-3 text-sm leading-6 text-[#b6c2cf]">{enrollmentMessage}{enrollmentSent && <> <Link href="/suinda" className="font-medium text-cyan-200 underline underline-offset-4">Acompanhar em Minhas inscrições</Link>.</>}{draftEnrollmentId && !enrollmentSent && <> <Link href={`/suinda/learning/${encodeURIComponent(draftEnrollmentId)}/documents`} className="ml-1 font-medium text-cyan-200 underline underline-offset-4">Continuar na área da inscrição</Link>.</>}</p>}
              </> : course.state === "enrollment_open" && course.payload.format === "cohort" ? <p className="mt-5 rounded-xl border border-[#3b4754] bg-white/[0.03] p-3 text-sm leading-6 text-[#b6c2cf]">{cohortLoading ? "Carregando turmas abertas…" : cohortError || "Não há turmas abertas para inscrição neste momento."}</p> : <p className="mt-5 rounded-xl border border-[#3b4754] bg-white/[0.03] p-3 text-sm leading-6 text-[#b6c2cf]">As inscrições ainda não estão disponíveis para este curso.</p>}
            </aside>
          </div>
          {(course.payload.tags || []).length > 0 && <div className="mt-6 flex flex-wrap gap-2">{course.payload.tags?.map((tag) => <span key={tag} className="rounded-lg border border-[#3b4754] px-3 py-1.5 text-xs text-[#9fadbc]">{tag}</span>)}</div>}
        </>}
      </div>
    </main>
  );
}
