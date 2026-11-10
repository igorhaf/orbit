'use client';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

const CodexIdeSidebar = dynamic(
  () => import('@/plugins/codex-ide/Sidebar').then((module) => module.CodexIdeSidebar),
  { ssr: false },
);

export function OrbitCodexIdeSidebar() {
  const pathname = usePathname();
  if (pathname === '/suinda' || pathname.startsWith('/suinda/')) return null;
  return <CodexIdeSidebar />;
}
