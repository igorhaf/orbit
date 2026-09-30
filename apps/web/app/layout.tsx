import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Orbit | Organize seu trabalho', description: 'Quadros, listas e cartões para organizar tudo em equipe.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const forcedTheme=process.env.NEXT_PUBLIC_ORBIT_FORCE_THEME==='dark'?'dark':undefined;
  return <html lang="pt-BR" data-theme={forcedTheme}><body>{children}</body></html>;
}
