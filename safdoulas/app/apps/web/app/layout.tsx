import type { Metadata } from 'next';
import './globals.css';
import { SkipToMain } from '@/components/skip-to-main';

export const metadata: Metadata = { title: 'Safdoulas | Acreditação de cursos de doulagem', description: 'Gestão de processos, evidências e decisões para acreditação de cursos de formação em doulagem, integrada à arquitetura Orbit.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const forcedTheme = process.env.NEXT_PUBLIC_ORBIT_THEME;
  const initialTheme = forcedTheme || 'terroso';
  const development = process.env.NEXT_PUBLIC_ORBIT_ENV === 'development';
  // Browser extensions can add body attributes such as cz-shortcut-listen before hydration.
  return <html lang="pt-BR" data-theme={initialTheme} data-theme-forced={forcedTheme ? 'true' : undefined}><body suppressHydrationWarning><SkipToMain/>{children}{development&&<div aria-label="Ambiente de desenvolvimento, porta 3001" className="fixed bottom-3 right-3 z-[100] rounded-full border border-[#ff991f] bg-[#172b4d] px-3 py-1.5 text-[11px] font-bold tracking-wide text-white shadow-lg">DEV · 3001</div>}</body></html>;
}
