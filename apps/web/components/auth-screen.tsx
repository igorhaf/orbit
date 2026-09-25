'use client';
import { useState } from 'react';
import { ArrowRight, CheckCircle2, LayoutDashboard, Sparkles } from 'lucide-react';
import { send, setSession, User } from '@/lib/api';

export function AuthScreen({ onDone }: { onDone: (user: User) => void }) {
  const [email,setEmail] = useState('igorhaf@gmail.com');
  const [password,setPassword] = useState('');
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
      <span className="flex h-9 w-9 items-center justify-center rounded bg-[#0c66e4] text-white"><LayoutDashboard size={24} strokeWidth={2.8}/></span>
      <strong className="text-[30px] tracking-[-1.5px]">Orbit</strong>
    </div>
    <div className="mx-auto mt-8 grid max-w-[1040px] items-center gap-12 px-4 pb-16 md:grid-cols-2 md:gap-16 md:px-10">
      <div className="hidden md:block">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-[#e9f2ff] px-3 py-1 text-xs font-bold text-[#0c66e4]"><Sparkles size={14}/> TUDO EM UM SÓ LUGAR</div>
        <h1 className="text-[43px] font-bold leading-[1.12] tracking-[-1.5px] text-[#172b4d]">Seu trabalho, com uma visão <span className="text-[#0c66e4]">mais clara.</span></h1>
        <p className="mt-5 max-w-md text-lg leading-7 text-[#44546f]">Acompanhe o que vem pela frente, veja as novidades e organize seus projetos em quadros.</p>
        <div className="mt-8 space-y-3 text-sm text-[#44546f]">
          {['Tarefas e prazos em destaque','Quadros, listas e cartões','Atividade e notificações em um lugar'].map(item => <div key={item} className="flex items-center gap-3"><CheckCircle2 className="text-[#22a06b]" size={19}/>{item}</div>)}
        </div>
        <div className="mt-10 flex h-40 max-w-md gap-3 overflow-hidden rounded-xl bg-gradient-to-br from-[#0c66e4] to-[#0747a6] p-5 shadow-xl">
          {[2,2,1].map((count,index) => <div key={index} className="w-1/3 rounded bg-[#f1f2f4] p-2">
            <div className="mb-2 h-2 w-14 rounded bg-[#8590a2]"/>
            {Array.from({length:count}).map((_,cardIndex)=><div key={cardIndex} className="mb-1 h-9 rounded bg-white shadow"/>)}
          </div>)}
        </div>
      </div>
      <div className="mx-auto w-full max-w-[420px] rounded-xl bg-white px-6 py-8 shadow-[0_8px_32px_#091e421a] sm:px-10">
        <h2 className="text-center text-base font-bold">Entre para continuar</h2>
        <p className="mt-1 text-center text-sm text-[#626f86]">Este espaço usa uma conta pessoal.</p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          <div><label htmlFor="email" className="mb-1 block text-xs font-bold">E-mail</label><input id="email" required type="email" value={email} onChange={e=>setEmail(e.target.value)} className="w-full rounded border border-[#8590a2] px-3 py-2.5 text-sm"/></div>
          <div><label htmlFor="password" className="mb-1 block text-xs font-bold">Senha</label><input id="password" required type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Sua senha" className="w-full rounded border border-[#8590a2] px-3 py-2.5 text-sm"/></div>
          {error && <p role="alert" className="rounded bg-[#ffebe6] px-3 py-2 text-xs text-[#ae2a19]">{error}</p>}
          <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded bg-[#0c66e4] py-2.5 text-sm font-semibold text-white hover:bg-[#0055cc]">{busy?'Aguarde...':'Entrar'} <ArrowRight size={16}/></button>
        </form>
        <p className="mt-6 border-t border-[#dfe1e6] pt-5 text-center text-xs text-[#626f86]">Acesso exclusivo da conta configurada neste projeto.</p>
      </div>
    </div>
  </div>;
}
