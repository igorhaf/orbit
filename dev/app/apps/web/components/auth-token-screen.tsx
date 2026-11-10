'use client';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { send } from '@/lib/api';

export function AuthTokenScreen({ mode }: { mode: 'recover' | 'verify' }) {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const complete = mode === 'verify' || Boolean(token);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(''); setError('');
    try {
      if (complete) {
        await send('/auth/complete', 'POST', { token, password });
        setMessage(mode === 'verify' ? 'Convite concluído. Sua senha foi definida; agora você pode entrar.' : 'Senha atualizada. As sessões anteriores foram encerradas.');
      } else {
        await send('/auth/recovery', 'POST', { email });
        setMessage('Se o endereço puder receber uma recuperação, você receberá as instruções por e-mail.');
      }
    } catch (reason) { setError(complete ? 'Link inválido, expirado ou já utilizado. Solicite um novo convite ou link de recuperação.' : (reason as Error).message); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto mt-12 w-full max-w-md rounded-xl bg-white p-6 shadow-[0_8px_32px_#091e421a] sm:p-9">
    <h1 className="text-xl font-bold text-[#172b4d]">{complete ? (mode === 'verify' ? 'Concluir convite' : 'Criar nova senha') : 'Recuperar senha'}</h1>
    <p className="mt-2 text-sm text-[#626f86]">{complete ? 'Defina uma senha com pelo menos 12 caracteres.' : 'Informe seu e-mail. A resposta será igual para contas existentes e inexistentes.'}</p>
    <form onSubmit={submit} className="mt-6 space-y-4">
      {complete ? <label className="block text-sm font-semibold">Nova senha<input required type="password" minLength={12} maxLength={200} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} className="mt-1 min-h-11 w-full rounded border border-[#8590a2] px-3"/></label> : <label className="block text-sm font-semibold">E-mail<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 min-h-11 w-full rounded border border-[#8590a2] px-3"/></label>}
      {error&&<p role="alert" className="rounded bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}
      {message&&<p role="status" className="rounded bg-[#dcfff1] p-3 text-sm text-[#164b35]">{message}</p>}
      <button disabled={busy|| (complete&&!token)} className="min-h-11 w-full rounded bg-[#0c66e4] px-4 font-semibold text-white disabled:opacity-60">{busy?'Aguarde...':complete?'Definir senha':'Enviar instruções'}</button>
    </form>
    <Link href="/" className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-[#0c66e4]">Voltar para entrar</Link>
  </main>;
}
