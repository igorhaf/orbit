import type { Metadata } from 'next';
import './globals.css';
import { BrandProvider } from '@/components/branding';
import { CodexIdeSidebar } from '@/components/codex-ide-sidebar';
import { SkipToMain } from '@/components/skip-to-main';
import { NavigationAnnouncer } from '@/components/navigation-announcer';

export const metadata: Metadata = { title: 'Orbit | Organize seu trabalho', description: 'Quadros, listas e cartões para organizar tudo em equipe.', icons: { icon: '/brand-orbit.svg' } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const forcedTheme = process.env.NEXT_PUBLIC_ORBIT_THEME;
  const development = process.env.NEXT_PUBLIC_ORBIT_ENV === 'development';
  const developmentPort = process.env.NEXT_PUBLIC_ORBIT_PORT || '3001';
  // Browser extensions can add body attributes such as cz-shortcut-listen before hydration.
  return <html lang="pt-BR" data-theme={forcedTheme || undefined} data-theme-forced={forcedTheme ? 'true' : undefined}><body suppressHydrationWarning><BrandProvider><SkipToMain/><NavigationAnnouncer/>{children}<CodexIdeSidebar/></BrandProvider>{development&&<div aria-label={`Ambiente de desenvolvimento, porta ${developmentPort}`} className="fixed bottom-3 right-3 z-[100] rounded-full border border-[#ff991f] bg-[#172b4d] px-3 py-1.5 text-[11px] font-bold tracking-wide text-white shadow-lg">DEV · {developmentPort}</div>}</body></html>;
}
