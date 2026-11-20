'use client';

import { useState, type FormEvent } from 'react';
import { send } from '@/lib/api';

export function EmailChangeForm({ currentEmail }: { currentEmail: string }) {
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await send('/auth/email-change', 'POST', { email, current_password: currentPassword });
      setCurrentPassword('');
      setMessage('Enviamos um link de confirmação para o novo endereço. O e-mail da conta só muda depois da confirmação.');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="rounded-xl border border-[#dfe1e6] bg-white p-6 shadow-sm">
    <h2 className="text-lg font-bold">Alterar e-mail da conta</h2>
    <p className="mt-1 text-sm text-[#626f86]">Confirme a alteração pelo link enviado ao novo endereço. Sua senha atual será solicitada antes do envio.</p>
    <form onSubmit={submit} className="mt-4 grid max-w-lg gap-3">
      <p className="text-xs text-[#626f86]">E-mail atual: <span className="font-semibold">{currentEmail}</span></p>
      <label className="text-xs font-bold">Novo e-mail<input required type="email" maxLength={320} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 min-h-10 w-full rounded border border-[#8590a2] px-3 text-sm font-normal" /></label>
      <label className="text-xs font-bold">Senha atual<input required type="password" maxLength={200} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="mt-1 min-h-10 w-full rounded border border-[#8590a2] px-3 text-sm font-normal" /></label>
      {error && <p role="alert" className="text-sm text-[#ae2a19]">{error}</p>}
      {message && <p role="status" className="text-sm text-[#216e4e]">{message}</p>}
      <button disabled={busy || !email.trim() || email.trim().toLowerCase() === currentEmail.toLowerCase() || !currentPassword} className="min-h-10 justify-self-start rounded bg-[#0c66e4] px-4 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Enviando…' : 'Enviar confirmação'}</button>
    </form>
  </section>;
}
