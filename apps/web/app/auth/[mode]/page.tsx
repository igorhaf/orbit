import { Suspense } from 'react';
import { AuthTokenScreen } from '@/components/auth-token-screen';
import { BrandName } from '@/components/branding';

export default async function AuthTokenPage({ params }: { params: Promise<{ mode: string }> }) {
  const { mode } = await params;
  if (mode !== 'recover' && mode !== 'verify') return <main className="p-8">Link de autenticação inválido.</main>;
  return <div className="min-h-screen bg-[#f8f9fb] px-4 py-8"><div className="text-center text-2xl font-bold text-[#172b4d]"><BrandName/></div><Suspense fallback={<p className="p-8 text-center">Carregando...</p>}><AuthTokenScreen mode={mode}/></Suspense></div>;
}
