import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'SafDoulas | Doulas conectadas', description: 'Um espaço para aproximar doulas, compartilhar saberes e fortalecer práticas de cuidado ao longo da jornada perinatal.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const forcedTheme = process.env.NEXT_PUBLIC_ORBIT_THEME;
  const development = process.env.NEXT_PUBLIC_ORBIT_ENV === 'development';
  // Browser extensions can add body attributes such as cz-shortcut-listen before hydration.
  return <html lang="pt-BR" data-theme={forcedTheme || undefined} data-theme-forced={forcedTheme ? 'true' : undefined}><body suppressHydrationWarning>{children}{development&&<div aria-label="Ambiente de desenvolvimento, porta 3001" className="fixed bottom-3 right-3 z-[100] rounded-full border border-[#ff991f] bg-[#172b4d] px-3 py-1.5 text-[11px] font-bold tracking-wide text-white shadow-lg">DEV · 3001</div>}</body></html>;
}
