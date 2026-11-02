'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Eye, EyeOff, Sparkles } from 'lucide-react';
import { api, send, setSession, User } from '@/lib/api';
import { BrandMark, useBranding } from '@/components/branding';

export function AuthScreen({ onDone }: { onDone: (user: User) => void }) {
  const isSuinda = process.env.NEXT_PUBLIC_ORBIT_PRODUCT === 'suinda';
  const brand=useBranding();
  const productName=isSuinda?'Suindá':brand.app_name;
  const loginTagline=isSuinda?'Aprenda no seu ritmo. Avance no seu caminho.':brand.login_tagline;
  const loginDescription=isSuinda?'Encontre cursos, acompanhe sua jornada e transforme conhecimento em novas possibilidades.':brand.login_description;
  const [email,setEmail] = useState('');
  const [name,setName] = useState('');
  const [password,setPassword] = useState('');
  const [mfaChallengeId,setMfaChallengeId] = useState('');
  const [mfaCode,setMfaCode] = useState('');
  const [mfaEmailHint,setMfaEmailHint] = useState('');
  const [termsAccepted,setTermsAccepted] = useState(false);
  const [registering,setRegistering] = useState(false);
  const [showPassword,setShowPassword] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const [socialProviders,setSocialProviders] = useState<Array<{id:string;name:string}>>([]);
  useEffect(()=>{let active=true;void api<{providers:Array<{id:string;name:string}>}>('/auth/social/providers').then(result=>{if(active)setSocialProviders(result.providers)}).catch(()=>undefined);return()=>{active=false}},[]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      if (registering) {
        await send('/auth/register','POST',{name,email,terms_accepted:termsAccepted,terms_version:'suinda-terms-v1'});
        setRegistering(false);setPassword('');setMessage('Se este endereço puder receber cadastro, você receberá um link para confirmar o e-mail e definir sua senha.');
        return;
      }
      const data=await send<{user?:User;token?:string;mfa_required?:boolean;challenge_id?:string;email_hint?:string}>('/auth/login','POST',
        mfaChallengeId ? {email,mfa_challenge_id:mfaChallengeId,mfa_code:mfaCode} : {email,password});
      if(data.mfa_required&&data.challenge_id){setMfaChallengeId(data.challenge_id);setMfaEmailHint(data.email_hint||email);setPassword('');setMessage(`Enviamos um código de acesso para ${data.email_hint||email}.`);return;}
      if(!data.token||!data.user)throw new Error('Não foi possível iniciar a sessão.');
      setSession(data.token,data.user);
      onDone(data.user);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function loginWith(provider:{id:string;name:string}){
    if(busy)return;setBusy(true);setError('');setMessage('');
    try{const result=await send<{url:string}>(`/auth/social/${encodeURIComponent(provider.id)}/start`,'POST',{});window.location.assign(result.url)}
    catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível iniciar o login social.');setBusy(false)}
  }
  return <main className={`min-h-screen ${isSuinda?'bg-[#080b12]':'bg-[#f8f9fb]'}`}>
    <div className={`flex items-center justify-center gap-2 pt-10 ${isSuinda?'text-white':'text-[#172b4d]'}`}>
      <BrandMark className="h-9 w-9" />
      <strong className="text-[30px] tracking-[-1.5px]">{productName}</strong>
    </div>
    <div className="mx-auto mt-8 grid max-w-[1040px] items-center gap-12 px-4 pb-16 md:grid-cols-2 md:gap-16 md:px-10">
      <div className="hidden md:block">
        <div className={`mb-5 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${isSuinda?'border border-cyan-200/20 bg-cyan-200/10 text-cyan-100':'bg-[#e9f2ff] text-[#0c66e4]'}`}><Sparkles size={14}/> TUDO EM UM SÓ LUGAR</div>
        <h1 className={`text-[43px] font-bold leading-[1.12] tracking-[-1.5px] ${isSuinda?'text-white':'text-[#172b4d]'}`}>{loginTagline}</h1>
        <p className={`mt-5 max-w-md text-lg leading-7 ${isSuinda?'text-slate-300':'text-[#44546f]'}`}>{loginDescription}</p>
        <div className={`mt-8 space-y-3 text-sm ${isSuinda?'text-slate-300':'text-[#44546f]'}`}>
          {brand.login_benefits.map(item => <div key={item} className="flex items-center gap-3"><CheckCircle2 className="text-[#22a06b]" size={19}/>{item}</div>)}
        </div>
        <div className={`mt-10 flex h-40 max-w-md gap-3 overflow-hidden rounded-xl p-5 shadow-xl ${isSuinda?'border border-white/10 bg-gradient-to-br from-cyan-900/60 to-slate-900':'bg-gradient-to-br from-[#0c66e4] to-[#0747a6]'}`}>
          {[2,2,1].map((count,index) => <div key={index} className={`w-1/3 rounded p-2 ${isSuinda?'bg-slate-800':'bg-[#f1f2f4]'}`}>
            <div className="mb-2 h-2 w-14 rounded bg-[#8590a2]"/>
            {Array.from({length:count}).map((_,cardIndex)=><div key={cardIndex} className="mb-1 h-9 rounded bg-white shadow"/>)}
          </div>)}
        </div>
      </div>
      <div className={`mx-auto w-full max-w-[420px] rounded-xl px-6 py-8 shadow-[0_8px_32px_#091e421a] sm:px-10 ${isSuinda?'border border-white/10 bg-[#101621] text-white shadow-black/30':'bg-white'}`}>
        <h2 className="text-center text-base font-bold">{registering?'Criar conta de aluno':'Entre para continuar'}</h2>
        <p className={`mt-1 text-center text-sm ${isSuinda?'text-slate-400':'text-[#626f86]'}`}>{registering?'Informe seu nome e e-mail. Enviaremos um link para confirmar a conta.':'Entre com seu e-mail e senha.'}</p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          {registering&&<div><label htmlFor="name" className="mb-1 block text-xs font-bold">Nome completo</label><input id="name" required maxLength={300} autoComplete="name" value={name} onChange={e=>setName(e.target.value)} className={`min-h-11 w-full rounded border px-3 py-2.5 text-sm ${isSuinda?'border-white/15 bg-[#090e18] text-white placeholder:text-slate-500':'border-[#8590a2]'}`}/></div>}
          <div><label htmlFor="email" className="mb-1 block text-xs font-bold">E-mail</label><input id="email" required type="email" value={email} onChange={e=>setEmail(e.target.value)} className={`min-h-11 w-full rounded border px-3 py-2.5 text-sm ${isSuinda?'border-white/15 bg-[#090e18] text-white placeholder:text-slate-500':'border-[#8590a2]'}`}/></div>
          {!registering&&!mfaChallengeId&&<div><label htmlFor="password" className="mb-1 block text-xs font-bold">Senha</label><div className="relative"><input id="password" required type={showPassword?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Sua senha" className={`min-h-11 w-full rounded border py-2.5 pl-3 pr-12 text-sm ${isSuinda?'border-white/15 bg-[#090e18] text-white placeholder:text-slate-500':'border-[#8590a2]'}`}/><button type="button" onClick={()=>setShowPassword(visible=>!visible)} aria-label={showPassword?'Ocultar senha':'Mostrar senha'} aria-controls="password" className={`absolute inset-y-0 right-0 flex min-h-11 w-11 items-center justify-center rounded-r focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${isSuinda?'text-slate-400 hover:text-white focus-visible:ring-cyan-300':'text-[#626f86] hover:text-[#172b4d] focus-visible:ring-[#0c66e4]'}`}><span className="sr-only">{showPassword?'Ocultar senha':'Mostrar senha'}</span>{showPassword?<EyeOff size={18} aria-hidden="true"/>:<Eye size={18} aria-hidden="true"/>}</button></div></div>}
          {!registering&&mfaChallengeId&&<div><p className={`mb-2 text-xs ${isSuinda?'text-slate-300':'text-[#626f86]'}`}>A verificação em duas etapas está ativa. Digite o código de seis dígitos enviado para {mfaEmailHint}.</p><label htmlFor="mfa-code" className="mb-1 block text-xs font-bold">Código de acesso</label><input id="mfa-code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={event=>setMfaCode(event.target.value.replace(/\D/g,'').slice(0,6))} className={`min-h-11 w-full rounded border px-3 py-2.5 text-sm tracking-[.3em] ${isSuinda?'border-white/15 bg-[#090e18] text-white':'border-[#8590a2]'}`}/></div>}
          {registering&&<label htmlFor="terms-accepted" className="flex items-start gap-3 text-xs leading-5 text-slate-300"><input id="terms-accepted" required type="checkbox" checked={termsAccepted} onChange={e=>setTermsAccepted(e.target.checked)} className="mt-1 size-4 accent-cyan-300"/><span>Li e aceito os <Link href="/suinda/terms" target="_blank" className="font-semibold text-cyan-200 underline">termos de uso e aviso de privacidade</Link>.</span></label>}
          {error && <p role="alert" className="rounded bg-[#ffebe6] px-3 py-2 text-xs text-[#ae2a19]">{error}</p>}
          {message&&<p role="status" className={`rounded p-3 text-xs ${isSuinda?'border border-emerald-300/20 bg-emerald-300/10 text-emerald-100':'bg-[#dcfff1] text-[#164b35]'}`}>{message}</p>}
          <button disabled={busy} className={`flex min-h-11 w-full items-center justify-center gap-2 rounded py-2.5 text-sm font-semibold text-white ${isSuinda?'bg-cyan-300 text-slate-950 hover:bg-cyan-200':'bg-[#0c66e4] hover:bg-[#0055cc]'}`}>{busy?'Aguarde...':registering?'Enviar link de confirmação':mfaChallengeId?'Confirmar código':'Entrar'} <ArrowRight size={16}/></button>
        </form>
        {!registering&&!mfaChallengeId&&socialProviders.length>0&&<div className="mt-5 border-t border-white/10 pt-4"><p className={`mb-3 text-center text-xs ${isSuinda?'text-slate-400':'text-[#626f86]'}`}>Ou entre com</p><div className="grid gap-2">{socialProviders.map(provider=><button key={provider.id} type="button" disabled={busy} onClick={()=>void loginWith(provider)} className={`min-h-11 rounded border px-3 text-sm font-semibold disabled:opacity-50 ${isSuinda?'border-white/15 bg-white/[0.03] text-slate-100 hover:bg-white/[0.07]':'border-[#dfe1e6] bg-white text-[#172b4d] hover:bg-[#f7f8fa]'}`}>{provider.name}</button>)}</div></div>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">{!mfaChallengeId&&<Link href="/auth/recover" className={`inline-flex min-h-11 items-center text-sm font-semibold hover:underline ${isSuinda?'text-cyan-200':'text-[#0c66e4]'}`}>Esqueci minha senha</Link>}{mfaChallengeId&&<button type="button" onClick={()=>{setMfaChallengeId('');setMfaCode('');setMfaEmailHint('');setMessage('');setError('');}} className={`inline-flex min-h-11 items-center text-sm font-semibold hover:underline ${isSuinda?'text-cyan-200':'text-[#0c66e4]'}`}>Voltar ao login</button>}{isSuinda&&<Link href="/suinda/catalog" className="inline-flex min-h-11 items-center text-sm font-semibold text-cyan-200 hover:underline">Explorar cursos</Link>}</div>
        {isSuinda&&<button type="button" onClick={()=>{setRegistering(value=>!value);setError('');setMessage('');}} className="mt-2 min-h-11 w-full text-sm font-semibold text-cyan-200 hover:underline">{registering?'Já tenho uma conta':'Criar conta de aluno'}</button>}
        <p className={`mt-6 border-t pt-5 text-center text-xs ${isSuinda?'border-white/10 text-slate-400':'border-[#dfe1e6] text-[#626f86]'}`}>{isSuinda?'Acesso seguro à sua jornada de aprendizagem.':'Acesso seguro aos seus quadros e projetos.'}</p>
      </div>
    </div>
  </main>;
}
