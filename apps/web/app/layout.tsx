import type { Metadata } from 'next';
import './globals.css';
import { BrandProvider } from '@/components/branding';

export const metadata: Metadata = { title: 'Orbit | Organize seu trabalho', description: 'Quadros, listas e cartões para organizar tudo em equipe.', icons: { icon: '/brand-orbit.svg' } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const forcedTheme = process.env.NEXT_PUBLIC_ORBIT_THEME;
  const development = process.env.NEXT_PUBLIC_ORBIT_ENV === 'development';
  // Browser extensions can add body attributes such as cz-shortcut-listen before hydration.
  return <html lang="pt-BR" data-theme={forcedTheme || undefined} data-theme-forced={forcedTheme ? 'true' : undefined}><body suppressHydrationWarning><BrandProvider>{children}</BrandProvider>{development&&<div aria-label="Ambiente de desenvolvimento, porta 3001" className="fixed bottom-3 right-3 z-[100] rounded-full border border-[#ff991f] bg-[#172b4d] px-3 py-1.5 text-[11px] font-bold tracking-wide text-white shadow-lg">DEV · 3001</div>}</body></html>;
}
