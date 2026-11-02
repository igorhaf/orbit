'use client';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { send } from '@/lib/api';

export function AuthTokenScreen({ mode }: { mode: 'recover' | 'verify' | 'change-email' }) {
  const isSuinda=process.env.NEXT_PUBLIC_ORBIT_PRODUCT==='suinda';
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const complete = mode === 'verify' || mode === 'change-email' || Boolean(token);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(''); setError('');
    try {
      if (mode === 'change-email') {
        await send('/auth/email-change/complete', 'POST', { token });
        setMessage('E-mail confirmado. Por segurança, entre novamente com o novo endereço.');
      } else if (complete) {
        await send('/auth/complete', 'POST', { token, password, ...(mode === 'verify' && isSuinda ? { terms_accepted: termsAccepted, terms_version: 'suinda-terms-v1' } : {}) });
        setMessage(mode === 'verify' ? 'Conta confirmada. Sua senha foi definida; agora você pode entrar.' : 'Senha atualizada. As sessões anteriores foram encerradas.');
      } else {
        await send('/auth/recovery', 'POST', { email });
        setMessage('Se o endereço puder receber uma recuperação, você receberá as instruções por e-mail.');
      }
    } catch (reason) { setError(complete ? 'Link inválido, expirado ou já utilizado. Solicite um novo convite ou link de recuperação.' : (reason as Error).message); }
    finally { setBusy(false); }
  }
  return <main className={`mx-auto mt-12 w-full max-w-md rounded-xl p-6 shadow-[0_8px_32px_#091e421a] sm:p-9 ${isSuinda?'border border-white/10 bg-[#101621] shadow-black/30':'bg-white'}`}>
    <h1 className={`text-xl font-bold ${isSuinda?'text-white':'text-[#172b4d]'}`}>{mode === 'change-email' ? 'Confirmar novo e-mail' : complete ? (mode === 'verify' ? 'Confirmar conta' : 'Criar nova senha') : 'Recuperar senha'}</h1>
    <p className={`mt-2 text-sm ${isSuinda?'text-slate-400':'text-[#626f86]'}`}>{mode === 'change-email' ? 'Confirme o novo endereço pelo link enviado para sua caixa de entrada.' : complete ? 'Defina uma senha com pelo menos 12 caracteres.' : 'Informe seu e-mail. A resposta será igual para contas existentes e inexistentes.'}</p>
    <form onSubmit={submit} className="mt-6 space-y-4">
      {mode === 'change-email' ? null : complete ? <label className="block text-sm font-semibold">Nova senha<input required type="password" minLength={12} maxLength={200} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} className={`mt-1 min-h-11 w-full rounded border px-3 ${isSuinda?'border-white/15 bg-[#090e18] text-white':'border-[#8590a2]'}`}/></label> : <label className="block text-sm font-semibold">E-mail<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} className={`mt-1 min-h-11 w-full rounded border px-3 ${isSuinda?'border-white/15 bg-[#090e18] text-white':'border-[#8590a2]'}`}/></label>}
      {complete && mode === 'verify' && isSuinda && <label className="flex items-start gap-2 text-xs font-normal leading-5 text-slate-300"><input type="checkbox" checked={termsAccepted} onChange={event=>setTermsAccepted(event.target.checked)} className="mt-1 accent-cyan-300" required /><span>Li e aceito os <Link href="/suinda/terms" className="text-cyan-200 underline underline-offset-2">termos de uso e o aviso de privacidade</Link> do Suindá (versão suinda-terms-v1).</span></label>}
      {error&&<p role="alert" className="rounded bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}
      {message&&<p role="status" className="rounded bg-[#dcfff1] p-3 text-sm text-[#164b35]">{message}</p>}
      <button disabled={busy|| (complete&&!token) || (mode === 'verify' && isSuinda && !termsAccepted)} className={`min-h-11 w-full rounded px-4 font-semibold disabled:opacity-60 ${isSuinda?'bg-cyan-300 text-slate-950':'bg-[#0c66e4] text-white'}`}>{busy?'Aguarde...':mode === 'change-email'?'Confirmar e-mail':complete?'Definir senha':'Enviar instruções'}</button>
    </form>
    <Link href="/" className={`mt-5 inline-flex min-h-11 items-center text-sm font-semibold ${isSuinda?'text-cyan-200':'text-[#0c66e4]'}`}>Voltar para entrar</Link>
  </main>;
}
