import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Orbit | Organize seu trabalho', description: 'Quadros, listas e cartões para organizar tudo em equipe.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const forceDark = process.env.NEXT_PUBLIC_ORBIT_THEME === 'dark';
  const development = process.env.NEXT_PUBLIC_ORBIT_ENV === 'development';
  return <html lang="pt-BR" data-theme={forceDark ? 'dark' : undefined} data-theme-forced={forceDark ? 'true' : undefined}><body>{children}{development&&<div aria-label="Ambiente de desenvolvimento, porta 3001" className="fixed bottom-3 right-3 z-[100] rounded-full border border-[#ff991f] bg-[#172b4d] px-3 py-1.5 text-[11px] font-bold tracking-wide text-white shadow-lg">DEV · 3001</div>}</body></html>;
}
