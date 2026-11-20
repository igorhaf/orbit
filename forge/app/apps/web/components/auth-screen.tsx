'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Eye, EyeOff, Sparkles } from 'lucide-react';
import { api, send, setSession, User } from '@/lib/api';
import { BrandMark, useBranding } from '@/components/branding';

type LoginResult={user?:User;token?:string;mfa_required?:boolean;challenge_id?:string;email_hint?:string};
type SocialProvider={id:string;name:string};
export function AuthScreen({ onDone }: { onDone: (user: User) => void }) {
  const brand=useBranding();
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [mfaCode,setMfaCode]=useState('');
  const [mfaChallenge,setMfaChallenge]=useState<{id:string;hint:string}|null>(null);
  const [providers,setProviders]=useState<SocialProvider[]>([]);
  const [showPassword,setShowPassword] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  useEffect(()=>{let active=true;void api<{providers:SocialProvider[]}>('/auth/social/providers').then(result=>{if(active)setProviders(result.providers)}).catch(()=>undefined);return()=>{active=false}},[]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const data=await send<LoginResult>('/auth/login','POST',mfaChallenge?{email,mfa_challenge_id:mfaChallenge.id,mfa_code:mfaCode}:{email,password});
      if(data.mfa_required&&data.challenge_id){setMfaChallenge({id:data.challenge_id,hint:data.email_hint||email});setMfaCode('');return;}
      if(!data.user||!data.token)throw new Error('A API não retornou uma sessão válida.');
      setSession(data.token,data.user);onDone(data.user);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function socialLogin(provider:string){setBusy(true);setError('');try{const result=await send<{url:string}>('/auth/social/'+encodeURIComponent(provider)+'/start','POST',{});window.location.assign(result.url)}catch(err){setError((err as Error).message);setBusy(false)}}
  return <div className="min-h-screen bg-[#f8f9fb]">
    <div className="flex items-center justify-center gap-2 pt-10 text-[#172b4d]"><BrandMark className="h-9 w-9"/><strong className="text-[30px] tracking-[-1.5px]">{brand.app_name}</strong></div>
    <div className="mx-auto mt-8 grid max-w-[1040px] items-center gap-12 px-4 pb-16 md:grid-cols-2 md:gap-16 md:px-10">
      <div className="hidden md:block"><div className="mb-5 inline-flex items-center gap-2 rounded-full bg-[#e9f2ff] px-3 py-1 text-xs font-bold text-[#0c66e4]"><Sparkles size={14}/> TUDO EM UM SÓ LUGAR</div><h1 className="text-[43px] font-bold leading-[1.12] tracking-[-1.5px] text-[#172b4d]">{brand.login_tagline}</h1><p className="mt-5 max-w-md text-lg leading-7 text-[#44546f]">{brand.login_description}</p><div className="mt-8 space-y-3 text-sm text-[#44546f]">{brand.login_benefits.map(item=><div key={item} className="flex items-center gap-3"><CheckCircle2 className="text-[#22a06b]" size={19}/>{item}</div>)}</div><div className="mt-10 flex h-40 max-w-md gap-3 overflow-hidden rounded-xl bg-gradient-to-br from-[#0c66e4] to-[#0747a6] p-5 shadow-xl">{[2,2,1].map((count,index)=><div key={index} className="w-1/3 rounded bg-[#f1f2f4] p-2"><div className="mb-2 h-2 w-14 rounded bg-[#8590a2]"/>{Array.from({length:count}).map((_,cardIndex)=><div key={cardIndex} className="mb-1 h-9 rounded bg-white shadow"/>)}</div>)}</div></div>
      <div className="mx-auto w-full max-w-[420px] rounded-xl bg-white px-6 py-8 shadow-[0_8px_32px_#091e421a] sm:px-10"><h2 className="text-center text-base font-bold">{mfaChallenge?'Confirme seu acesso':'Entre para continuar'}</h2><p className="mt-1 text-center text-sm text-[#626f86]">{mfaChallenge?`Informe o código enviado para ${mfaChallenge.hint}.`:'Entre com seu e-mail e senha.'}</p>
        <form onSubmit={submit} className="mt-7 space-y-4"><div><label htmlFor="email" className="mb-1 block text-xs font-bold">E-mail</label><input id="email" required type="email" value={email} onChange={e=>setEmail(e.target.value)} readOnly={Boolean(mfaChallenge)} className="min-h-11 w-full rounded border border-[#8590a2] px-3 py-2.5 text-sm read-only:bg-[#f1f2f4]"/></div>
          {mfaChallenge?<div><label htmlFor="mfa-code" className="mb-1 block text-xs font-bold">Código de acesso</label><input id="mfa-code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={e=>setMfaCode(e.target.value.replace(/\D/g,'').slice(0,6))} className="min-h-11 w-full rounded border border-[#8590a2] px-3 text-sm tracking-[.3em]"/></div>:<div><label htmlFor="password" className="mb-1 block text-xs font-bold">Senha</label><div className="relative"><input id="password" required type={showPassword?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Sua senha" className="min-h-11 w-full rounded border border-[#8590a2] py-2.5 pl-3 pr-12 text-sm"/><button type="button" onClick={()=>setShowPassword(visible=>!visible)} aria-label={showPassword?'Ocultar senha':'Mostrar senha'} aria-controls="password" className="absolute inset-y-0 right-0 flex min-h-11 w-11 items-center justify-center rounded-r text-[#626f86] hover:text-[#172b4d]">{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></div>}
          {error&&<p role="alert" className="rounded bg-[#ffebe6] px-3 py-2 text-xs text-[#ae2a19]">{error}</p>}<button disabled={busy||Boolean(mfaChallenge&&mfaCode.length!==6)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded bg-[#0c66e4] py-2.5 text-sm font-semibold text-white hover:bg-[#0055cc] disabled:opacity-60">{busy?'Aguarde...':mfaChallenge?'Confirmar código':'Entrar'} <ArrowRight size={16}/></button>
        </form>
        {mfaChallenge?<button type="button" onClick={()=>{setMfaChallenge(null);setMfaCode('')}} className="mt-3 min-h-11 text-sm font-semibold text-[#0c66e4]">Voltar ao login</button>:<><Link href="/auth/recover" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-[#0c66e4] hover:underline">Esqueci minha senha</Link>{providers.length>0&&<div className="mt-5 border-t border-[#dfe1e6] pt-4"><p className="mb-3 text-center text-xs text-[#626f86]">ou entre com</p><div className="grid gap-2">{providers.map(provider=><button key={provider.id} type="button" disabled={busy} onClick={()=>void socialLogin(provider.id)} className="min-h-11 rounded border border-[#dfe1e6] px-3 text-sm font-semibold hover:bg-[#f7f8fa] disabled:opacity-60">Continuar com {provider.name}</button>)}</div></div>}</>}
        <p className="mt-6 border-t border-[#dfe1e6] pt-5 text-center text-xs text-[#626f86]">Acesso seguro aos seus quadros e projetos.</p>
      </div>
    </div>
  </div>;
}
