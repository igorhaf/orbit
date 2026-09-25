import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Orbit | Organize seu trabalho', description: 'Quadros, listas e cartões para organizar tudo em equipe.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
