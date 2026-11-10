import { Suspense } from 'react';
import { AuthTokenScreen } from '@/components/auth-token-screen';
import { BrandName } from '@/components/branding';

export default async function AuthTokenPage({ params }: { params: Promise<{ mode: string }> }) {
  const { mode } = await params;
  if (mode !== 'recover' && mode !== 'verify' && mode !== 'change-email') return <main className="p-8"><h1 className="text-xl font-semibold">Link de autenticação inválido</h1></main>;
  const isSuinda=process.env.NEXT_PUBLIC_ORBIT_PRODUCT==='suinda';
  return <div className={`min-h-screen px-4 py-8 ${isSuinda?'bg-[#080b12] text-white':'bg-[#f8f9fb]'}`}><div className={`text-center text-2xl font-bold ${isSuinda?'text-white':'text-[#172b4d]'}`}><BrandName/></div><Suspense fallback={<p className="p-8 text-center">Carregando...</p>}><AuthTokenScreen mode={mode}/></Suspense></div>;
}
