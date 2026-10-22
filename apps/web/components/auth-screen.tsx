'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Eye, EyeOff, Sparkles, TreeDeciduous } from 'lucide-react';
import { send, setSession, User } from '@/lib/api';

export function AuthScreen({ onDone }: { onDone: (user: User) => void }) {
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [showPassword,setShowPassword] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const data=await send<{user:User;token:string}>('/auth/login','POST',{email,password});
      setSession(data.token,data.user);
      onDone(data.user);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="min-h-screen bg-[#f8f9fb]">
    <div className="flex items-center justify-center gap-2 pt-10 text-[#172b4d]">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f9e6dc] text-[#7c2816]"><TreeDeciduous size={27} strokeWidth={2.2}/></span>
      <strong className="text-[30px] tracking-[-1.5px]">SafDoulas</strong>
    </div>
    <div className="mx-auto mt-8 grid max-w-[1040px] items-center gap-12 px-4 pb-16 md:grid-cols-2 md:gap-16 md:px-10">
      <div className="mx-auto w-full max-w-[420px] md:max-w-none">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#f9e6dc] px-3 py-1 text-xs font-bold text-[#7c2816]"><Sparkles size={14}/> CONEXÃO E APRENDIZADO</div>
        <h1 className="text-[30px] font-bold leading-[1.12] tracking-[-1px] text-[#652719] md:text-[43px] md:tracking-[-1.5px]">Doulas conectadas, aprendendo e crescendo juntas.</h1>
        <p className="mt-4 max-w-md text-base leading-7 text-[#51413c] md:mt-5 md:text-lg">Um espaço para aproximar doulas, compartilhar saberes e fortalecer práticas de cuidado ao longo da jornada perinatal.</p>
        <div className="mt-5 space-y-3 text-sm text-[#51413c] md:mt-8">
          {['Conecte-se com doulas e fortaleça sua rede de apoio','Compartilhe experiências e aprenda em comunidade','Organize formações, projetos e ações de cuidado'].map(item => <div key={item} className="flex items-center gap-3"><CheckCircle2 className="shrink-0 text-[#7c8b48]" size={19}/>{item}</div>)}
        </div>
        <div className="mt-10 hidden h-40 max-w-md gap-3 overflow-hidden rounded-xl bg-gradient-to-br from-[#9b3041] to-[#652719] p-5 shadow-xl md:flex">
          {[2,2,1].map((count,index) => <div key={index} className="w-1/3 rounded bg-[#f1f2f4] p-2">
            <div className="mb-2 h-2 w-14 rounded bg-[#8590a2]"/>
            {Array.from({length:count}).map((_,cardIndex)=><div key={cardIndex} className="mb-1 h-9 rounded bg-white shadow"/>)}
          </div>)}
        </div>
      </div>
      <div className="mx-auto w-full max-w-[420px] rounded-xl bg-white px-6 py-8 shadow-[0_8px_32px_#091e421a] sm:px-10">
        <h2 className="text-center text-base font-bold">Entre para continuar</h2>
        <p className="mt-1 text-center text-sm text-[#626f86]">Entre com seu e-mail e senha.</p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          <div><label htmlFor="email" className="mb-1 block text-xs font-bold">E-mail</label><input id="email" required type="email" value={email} onChange={e=>setEmail(e.target.value)} className="min-h-11 w-full rounded border border-[#8590a2] px-3 py-2.5 text-sm"/></div>
          <div><label htmlFor="password" className="mb-1 block text-xs font-bold">Senha</label><div className="relative"><input id="password" required type={showPassword?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Sua senha" className="min-h-11 w-full rounded border border-[#8590a2] py-2.5 pl-3 pr-12 text-sm"/><button type="button" onClick={()=>setShowPassword(visible=>!visible)} aria-label={showPassword?'Ocultar senha':'Mostrar senha'} aria-controls="password" className="absolute inset-y-0 right-0 flex min-h-11 w-11 items-center justify-center rounded-r text-[#626f86] hover:text-[#172b4d] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0c66e4]"><span className="sr-only">{showPassword?'Ocultar senha':'Mostrar senha'}</span>{showPassword?<EyeOff size={18} aria-hidden="true"/>:<Eye size={18} aria-hidden="true"/>}</button></div></div>
          {error && <p role="alert" className="rounded bg-[#ffebe6] px-3 py-2 text-xs text-[#ae2a19]">{error}</p>}
          <button disabled={busy} className="flex min-h-11 w-full items-center justify-center gap-2 rounded bg-[#0c66e4] py-2.5 text-sm font-semibold text-white hover:bg-[#0055cc]">{busy?'Aguarde...':'Entrar'} <ArrowRight size={16}/></button>
        </form>
        <Link href="/auth/recover" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-[#0c66e4] hover:underline">Esqueci minha senha</Link>
        <p className="mt-6 border-t border-[#dfe1e6] pt-5 text-center text-xs text-[#626f86]">Acesso seguro aos seus quadros e projetos.</p>
      </div>
    </div>
  </div>;
}
