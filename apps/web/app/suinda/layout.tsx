import type { Metadata } from "next";
import SuindaOrbitShell from "./orbit-shell";

export const metadata: Metadata = {
  title: "Suindá | Plataforma de cursos",
  description: "Cursos, turmas e aprendizagem com a experiência Orbit.",
};

export default function SuindaLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div id="suinda-root" data-suinda-font-scale="normal" suppressHydrationWarning>
    <style>{`
      #suinda-root { --text-xs:.75rem; --text-sm:.875rem; --text-base:1rem; --text-lg:1.125rem; --text-xl:1.25rem; --text-2xl:1.5rem; --text-3xl:1.875rem; --text-4xl:2.25rem; --text-5xl:3rem; --text-6xl:3.75rem; }
      #suinda-root[data-suinda-font-scale="small"] { --text-xs:.675rem; --text-sm:.7875rem; --text-base:.9rem; --text-lg:1.0125rem; --text-xl:1.125rem; --text-2xl:1.35rem; --text-3xl:1.6875rem; --text-4xl:2.025rem; --text-5xl:2.7rem; --text-6xl:3.375rem; }
      #suinda-root[data-suinda-font-scale="large"] { --text-xs:.825rem; --text-sm:.9625rem; --text-base:1.1rem; --text-lg:1.2375rem; --text-xl:1.375rem; --text-2xl:1.65rem; --text-3xl:2.0625rem; --text-4xl:2.475rem; --text-5xl:3.3rem; --text-6xl:4.125rem; }
      #suinda-root[data-suinda-font-scale="largest"] { --text-xs:.9375rem; --text-sm:1.09375rem; --text-base:1.25rem; --text-lg:1.40625rem; --text-xl:1.5625rem; --text-2xl:1.875rem; --text-3xl:2.34375rem; --text-4xl:2.8125rem; --text-5xl:3.75rem; --text-6xl:4.6875rem; }
      #suinda-root[data-suinda-font-scale="small"] [class~="text-[10px]"] { font-size:9px; }
      #suinda-root[data-suinda-font-scale="small"] [class~="text-[11px]"] { font-size:9.9px; }
      #suinda-root[data-suinda-font-scale="large"] [class~="text-[10px]"] { font-size:11px; }
      #suinda-root[data-suinda-font-scale="large"] [class~="text-[11px]"] { font-size:12.1px; }
      #suinda-root[data-suinda-font-scale="largest"] [class~="text-[10px]"] { font-size:12.5px; }
      #suinda-root[data-suinda-font-scale="largest"] [class~="text-[11px]"] { font-size:13.75px; }
    `}</style>
    <script dangerouslySetInnerHTML={{ __html: `(function(){function apply(){try{localStorage.removeItem("suinda:font-scale");var account=JSON.parse(localStorage.getItem("orbit_user")||"null");var value=account&&account.preferences&&account.preferences.fontScale;document.getElementById("suinda-root").dataset.suindaFontScale=["small","normal","large","largest"].indexOf(value)>=0?value:"normal"}catch(_){document.getElementById("suinda-root").dataset.suindaFontScale="normal"}}apply();window.addEventListener("account:changed",apply)})()` }} />
    <SuindaOrbitShell>{children}</SuindaOrbitShell>
  </div>;
}
