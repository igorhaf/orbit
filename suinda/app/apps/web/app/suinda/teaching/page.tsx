import { Suspense } from "react";
import TeacherDashboard from "../teacher-dashboard";

export default function SuindaTeachingPage() {
  return <Suspense fallback={<main className="min-h-full bg-[#1d2125] px-5 py-9 text-[#b6c2cf]" role="status">Carregando o painel docente…</main>}>
    <TeacherDashboard />
  </Suspense>;
}
