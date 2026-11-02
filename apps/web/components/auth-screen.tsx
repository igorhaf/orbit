'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Eye, EyeOff, LayoutDashboard, ShieldCheck, Sparkles } from 'lucide-react';
import { api, send, setSession, User } from '@/lib/api';

export function AuthScreen({ onDone }: { onDone: (user: User) => void }) {
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [showPassword,setShowPassword] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [mfaChallengeId,setMfaChallengeId]=useState('');
  const [mfaCode,setMfaCode]=useState('');
  const [mfaEmailHint,setMfaEmailHint]=useState('');
  const [socialProviders,setSocialProviders]=useState<Array<{id:string;name:string}>>([]);
  useEffect(()=>{let active=true;void api<{providers:Array<{id:string;name:string}>}>('/auth/social/providers').then(result=>{if(active)setSocialProviders(result.providers)}).catch(()=>undefined);return()=>{active=false}},[]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const data=await send<{user?:User;token?:string;mfa_required?:boolean;challenge_id?:string;email_hint?:string}>('/auth/login','POST',mfaChallengeId?{email,mfa_challenge_id:mfaChallengeId,mfa_code:mfaCode}:{email,password});
      if(data.mfa_required&&data.challenge_id){setMfaChallengeId(data.challenge_id);setMfaEmailHint(data.email_hint||email);setPassword('');return;}
      if(!data.user||!data.token)throw new Error('Não foi possível concluir a sessão.');
      setSession(data.token,data.user);
      onDone(data.user);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function loginWith(provider:{id:string;name:string}){setBusy(true);setError('');try{const result=await send<{url:string}>(`/auth/social/${encodeURIComponent(provider.id)}/start`,'POST',{});window.location.assign(result.url)}catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível iniciar o login social.');setBusy(false)}}
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
        <p className="mt-1 text-center text-sm text-[#626f86]">Entre com seu e-mail e senha.</p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          <div><label htmlFor="email" className="mb-1 block text-xs font-bold">E-mail</label><input id="email" required type="email" value={email} onChange={e=>setEmail(e.target.value)} className="min-h-11 w-full rounded border border-[#8590a2] px-3 py-2.5 text-sm"/></div>
          {!mfaChallengeId?<div><label htmlFor="password" className="mb-1 block text-xs font-bold">Senha</label><div className="relative"><input id="password" required type={showPassword?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Sua senha" className="min-h-11 w-full rounded border border-[#8590a2] py-2.5 pl-3 pr-12 text-sm"/><button type="button" onClick={()=>setShowPassword(visible=>!visible)} aria-label={showPassword?'Ocultar senha':'Mostrar senha'} aria-controls="password" className="absolute inset-y-0 right-0 flex min-h-11 w-11 items-center justify-center rounded-r text-[#626f86] hover:text-[#172b4d] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0c66e4]"><span className="sr-only">{showPassword?'Ocultar senha':'Mostrar senha'}</span>{showPassword?<EyeOff size={18} aria-hidden="true"/>:<Eye size={18} aria-hidden="true"/>}</button></div></div>:<div><p className="mb-2 text-xs text-[#626f86]">A verificação em duas etapas está ativa. Enviamos um código para {mfaEmailHint}.</p><label htmlFor="mfa-code" className="mb-1 block text-xs font-bold">Código de acesso</label><input id="mfa-code" autoFocus required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={e=>setMfaCode(e.target.value.replace(/\D/g,'').slice(0,6))} className="min-h-11 w-full rounded border border-[#8590a2] px-3 py-2.5 text-sm tracking-[.3em]"/></div>}
          {error && <p role="alert" className="rounded bg-[#ffebe6] px-3 py-2 text-xs text-[#ae2a19]">{error}</p>}
          <button disabled={busy||(Boolean(mfaChallengeId)&&mfaCode.length!==6)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded bg-[#0c66e4] py-2.5 text-sm font-semibold text-white hover:bg-[#0055cc]">{busy?'Aguarde...':mfaChallengeId?'Confirmar código e entrar':'Entrar'} <ArrowRight size={16}/></button>
        </form>
        {!mfaChallengeId&&socialProviders.length>0&&<div className="mt-5 border-t border-[#dfe1e6] pt-4"><p className="mb-3 text-center text-xs text-[#626f86]">Ou entre com</p><div className="grid gap-2">{socialProviders.map(provider=><button key={provider.id} type="button" disabled={busy} onClick={()=>void loginWith(provider)} className="min-h-11 rounded border border-[#dfe1e6] bg-white px-3 text-sm font-semibold text-[#172b4d] hover:bg-[#f7f8fa] disabled:opacity-50">{provider.name}</button>)}</div></div>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">{!mfaChallengeId?<Link href="/auth/recover" className="inline-flex min-h-11 items-center text-sm font-semibold text-[#0c66e4] hover:underline">Esqueci minha senha</Link>:<button type="button" onClick={()=>{setMfaChallengeId('');setMfaCode('');setMfaEmailHint('');setError('')}} className="inline-flex min-h-11 items-center text-sm font-semibold text-[#0c66e4] hover:underline">Voltar ao login</button>}{mfaChallengeId&&<ShieldCheck size={18} aria-hidden="true" className="text-[#0c66e4]"/>}</div>
        <p className="mt-6 border-t border-[#dfe1e6] pt-5 text-center text-xs text-[#626f86]">Acesso seguro aos seus quadros e projetos.</p>
      </div>
    </div>
  </div>;
}
