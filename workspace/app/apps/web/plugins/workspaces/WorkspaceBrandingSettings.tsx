"use client";
import { FormEvent, useEffect, useState } from 'react';
import Image from 'next/image';
import { api, send } from '@/lib/api';
import { accessButton as button, accessInput as input, accessPanel as panel } from '@/components/access-shell';

type Branding = {
  workspace_id: string; public_name: string | null; logo_url: string | null;
  primary_color: string; accent_color: string; custom_domain: string | null;
  domain_verified: boolean; verification_record: { type: 'TXT'; name: string; value: string } | null;
};

export function WorkspaceBrandingSettings({ workspace, canManage }: { workspace: string; canManage: boolean }) {
  const [value, setValue] = useState<Branding | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!canManage) return;
    let active = true;
    api<Branding>(`/workspaces/${workspace}/branding`).then(result => { if (active) setValue(result); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [workspace, canManage]);
  if (!canManage) return null;
  if (!value) return <section className={panel} aria-busy={!error}>{error ? <p role="alert">Não foi possível carregar a identidade institucional: {error}</p> : 'Carregando identidade da instituição…'}</section>;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const next = await send<Branding>(`/workspaces/${workspace}/branding`, 'PUT', {
        public_name: String(form.get('public_name') || ''), logo_url: String(form.get('logo_url') || ''),
        primary_color: String(form.get('primary_color')), accent_color: String(form.get('accent_color')),
        custom_domain: String(form.get('custom_domain') || ''),
      });
      setValue(next); setMessage('Identidade institucional salva.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true); setError(''); setMessage('');
    try { setValue(await send<Branding>(`/workspaces/${workspace}/branding/domain/verify`, 'POST', {})); setMessage('Domínio verificado. O roteamento e o TLS ainda precisam estar ativos na infraestrutura.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return <section className={`${panel} space-y-4`}>
    <div><h3 className="font-semibold">Identidade institucional</h3><p className="text-sm opacity-75">Marca, cores e domínio próprios deste workspace.</p></div>
    {error && <p role="alert" className="rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-red-200">{error}</p>}
    {message && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-3 text-emerald-200">{message}</p>}
    <p className="text-sm opacity-75">Para manter o contraste no tema escuro, a cor principal precisa atingir 4,5:1 com texto branco e a cor de destaque 4,5:1 sobre a superfície escura.</p>
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={save}>
      <label>Nome público<input name="public_name" maxLength={100} defaultValue={value.public_name || ''} className={input} /></label>
      <label>URL HTTPS do logo<input name="logo_url" type="url" defaultValue={value.logo_url || ''} className={input} placeholder="https://…" /></label>
      <label className="flex items-center gap-3">Cor principal<input name="primary_color" type="color" defaultValue={value.primary_color} className="h-11 w-16 rounded border bg-transparent" /></label>
      <label className="flex items-center gap-3">Cor de destaque<input name="accent_color" type="color" defaultValue={value.accent_color} className="h-11 w-16 rounded border bg-transparent" /></label>
      <label className="sm:col-span-2">Domínio próprio<input name="custom_domain" type="text" autoComplete="url" defaultValue={value.custom_domain || ''} className={input} placeholder="cursos.exemplo.com.br" /></label>
      <button disabled={busy} className={`${button} sm:col-span-2`}>Salvar identidade</button>
    </form>
    <div aria-label="Prévia da identidade institucional" className="flex items-center gap-3 rounded-xl border p-4" style={{ borderColor: value.accent_color }}>
      {value.logo_url ? <Image src={value.logo_url} alt="" width={48} height={48} unoptimized className="size-12 rounded object-contain" /> : <span aria-hidden="true" className="size-12 rounded" style={{ backgroundColor: value.primary_color }} />}
      <span className="min-w-0 flex-1 truncate text-lg font-semibold">{value.public_name || 'Nome da instituição'}</span>
      <span className="rounded px-3 py-2 text-xs font-semibold text-white" style={{ backgroundColor: value.primary_color }}>Cor principal</span>
    </div>
    {value.verification_record && <div className="space-y-2 rounded-lg border p-3">
      <p>{value.domain_verified ? 'Domínio verificado. A infraestrutura também deve apontar o domínio para esta aplicação e disponibilizar TLS.' : 'Publique este registro DNS TXT para comprovar a propriedade do domínio:'}</p>
      <dl className="grid gap-2 break-all text-sm sm:grid-cols-[auto_1fr]"><dt>Tipo</dt><dd>{value.verification_record.type}</dd><dt>Nome</dt><dd>{value.verification_record.name}</dd><dt>Valor</dt><dd>{value.verification_record.value}</dd></dl>
      {!value.domain_verified && <button type="button" disabled={busy} className={button} onClick={() => void verify()}>Verificar DNS</button>}
    </div>}
  </section>;
}
