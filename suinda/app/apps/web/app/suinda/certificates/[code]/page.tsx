"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, BadgeCheck, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";

type Validation = {
  authentic: true;
  status: "valid" | "revoked" | "expired";
  certificate_code: string;
  learner_name: string;
  course_title: string;
  certificate_kind?: "completion" | "participation" | "milestone";
  participation_scope?: string | null;
  milestone_title?: string | null;
  milestone_lesson_titles?: string[];
  workload_hours: number;
  issued_at: string | null;
  completed_at?: string | null;
  expires_at: string | null;
  signer_names: string[];
};

function dateLabel(value: string | null) {
  if (!value) return "Data não informada";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data inválida" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Recife" }).format(date);
}

export default function CertificateValidationPage() {
  const params = useParams<{ code: string }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  const [certificate, setCertificate] = useState<Validation | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.theme;
    root.dataset.theme = "dark";
    api<Validation>(`/public/suinda/certificates/${encodeURIComponent(code)}`)
      .then(setCertificate)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Não foi possível validar este certificado."))
      .finally(() => setLoading(false));
    return () => { if (previous) root.dataset.theme = previous; else delete root.dataset.theme; };
  }, [code]);

  const valid = certificate?.status === "valid";
  const statusColor = valid ? "emerald" : certificate?.status === "revoked" ? "rose" : "amber";
  const statusLabel = valid ? "Registro válido na plataforma" : certificate?.status === "revoked" ? "Certificado revogado" : "Certificado expirado";
  const statusStyles = { emerald: "bg-emerald-300/10 text-emerald-200", rose: "bg-rose-300/10 text-rose-200", amber: "bg-amber-300/10 text-amber-100" }[statusColor];
  const statusText = { emerald: "text-emerald-200", rose: "text-rose-200", amber: "text-amber-100" }[statusColor];
  const participation = certificate?.certificate_kind === "participation";
  const milestone = certificate?.certificate_kind === "milestone";
  return <main className="min-h-screen bg-[#1d2125] px-4 py-8 text-[#dee4ea] sm:px-8 sm:py-14"><div className="mx-auto max-w-3xl"><Link href="/suinda" className="inline-flex min-h-10 items-center gap-2 text-sm text-[#b6c2cf] hover:text-cyan-100"><ArrowLeft size={16} aria-hidden="true" /> Suindá</Link><section className="mt-6 rounded-3xl border border-[#3b4754] bg-[#2c333a] p-6 sm:p-10">{loading ? <p role="status" className="text-sm text-[#9fadbc]">Consultando autenticidade…</p> : certificate ? <><div className={`grid size-14 place-items-center rounded-2xl ${statusStyles}`}>{valid ? <BadgeCheck size={28} aria-hidden="true" /> : <ShieldAlert size={28} aria-hidden="true" />}</div><p className={`mt-5 text-xs font-semibold uppercase tracking-[.16em] ${statusText}`}>{statusLabel}</p><h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{certificate.learner_name}</h1><p className="mt-3 text-sm leading-6 text-[#b6c2cf]">{participation ? <>Participação nas atividades de <strong className="font-semibold text-white">{certificate.course_title}</strong>.</> : milestone ? <>Conclusão do marco <strong className="font-semibold text-white">{certificate.milestone_title || "intermediário"}</strong> no curso <strong className="font-semibold text-white">{certificate.course_title}</strong>.</> : <>Conclusão de <strong className="font-semibold text-white">{certificate.course_title}</strong>.</>} Carga horária: {certificate.workload_hours} horas.</p>{milestone && <p className="mt-3 rounded-xl border border-[#3b4754] bg-black/10 p-3 text-sm leading-6 text-[#b6c2cf]">Aulas do marco: {certificate.milestone_lesson_titles?.join(", ") || certificate.participation_scope}</p>}{participation && certificate.participation_scope && <p className="mt-3 rounded-xl border border-[#3b4754] bg-black/10 p-3 text-sm leading-6 text-[#b6c2cf]">Escopo: {certificate.participation_scope}</p>}<dl className="mt-7 grid gap-4 border-t border-[#3b4754] pt-5 sm:grid-cols-2"><div><dt className="text-xs text-[#9fadbc]">Código</dt><dd className="mt-1 break-all font-mono text-sm text-[#b6c2cf]">{certificate.certificate_code}</dd></div><div><dt className="text-xs text-[#9fadbc]">Data de emissão</dt><dd className="mt-1 text-sm text-[#b6c2cf]">{dateLabel(certificate.issued_at)}</dd></div>{certificate.completed_at && <div><dt className="text-xs text-[#9fadbc]">Data de conclusão/participação</dt><dd className="mt-1 text-sm text-[#b6c2cf]">{dateLabel(certificate.completed_at)}</dd></div>}{certificate.expires_at && <div><dt className="text-xs text-[#9fadbc]">Validade</dt><dd className="mt-1 text-sm text-[#b6c2cf]">{dateLabel(certificate.expires_at)}</dd></div>}{certificate.signer_names.length > 0 && <div><dt className="text-xs text-[#9fadbc]">Responsáveis</dt><dd className="mt-1 text-sm text-[#b6c2cf]">{certificate.signer_names.join(" · ")}</dd></div>}</dl><p role="note" className="mt-6 rounded-xl border border-amber-200/20 bg-amber-200/5 p-4 text-sm leading-6 text-[#d7c9a8]">Esta consulta confirma o registro e o estado atual no Suindá. O PDF não possui assinatura digital incorporada (PAdES/ICP-Brasil).</p></> : <div role="alert"><div className="grid size-14 place-items-center rounded-2xl bg-amber-300/10 text-amber-100"><ShieldAlert size={27} aria-hidden="true" /></div><h1 className="mt-5 text-xl font-semibold text-white">Não foi possível confirmar</h1><p className="mt-2 text-sm leading-6 text-[#b6c2cf]">{error || "O código não corresponde a um certificado público disponível."}</p></div>}</section></div></main>;
}
