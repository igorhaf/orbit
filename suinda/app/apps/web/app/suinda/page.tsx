"use client";

import { Suspense } from "react";
import StudentDashboard from "./student-dashboard";

export default function SuindaLearningHome() {
  return <Suspense fallback={<main className="min-h-full bg-[#1d2125] px-5 py-9 text-[#b6c2cf]" role="status">Carregando sua aprendizagem…</main>}>
    <StudentDashboard />
  </Suspense>;
}
