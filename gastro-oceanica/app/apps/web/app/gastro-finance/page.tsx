'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, getToken, send, type User, type Workspace } from '@/lib/api';
import { AccessShell, accessButton, accessInput, accessPanel } from '@/components/access-shell';

type Entry = { id: string; direction: 'receivable' | 'payable'; category: string; amount_minor: string; settled_minor: string; balance_minor: string; currency: 'BRL'; due_on: string | null; status: 'open' | 'partial' | 'settled' | 'void'; created_at: string };
type Movement = { id: string; entry_id: string; movement_type: 'settlement' | 'reversal'; amount_minor: string; method: string; reverses_id: string | null; reversal_reason: string | null; actor_id: string; created_at: string; direction: Entry['direction']; category: string; is_reversed: boolean };
const field = accessInput;
const maxAmountMinor = 99_999_999_999_999;
const categoryLabels: Record<string, string> = { service: 'Serviços', supplies: 'Suprimentos', facility: 'Instalações', staff: 'Equipe', utilities: 'Utilidades', other: 'Outros' };
const statusLabels: Record<Entry['status'], string> = { open: 'Em aberto', partial: 'Parcial', settled: 'Liquidado', void: 'Anulado' };
const methodLabels: Record<string, string> = { cash: 'Dinheiro', pix: 'PIX', bank_transfer: 'Transferência', card: 'Cartão', other: 'Outro' };
const reversalLabels: Record<string, string> = { duplicate: 'Lançamento duplicado', entered_in_error: 'Informação lançada incorretamente', refund: 'Devolução', other: 'Outro' };

function parseAmount(value: string) {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d{1,11}(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Informe um valor em reais com até duas casas decimais.');
  const [whole, fraction = ''] = normalized.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor < 1 || minor > maxAmountMinor) throw new Error('Valor financeiro fora do limite permitido.');
  return minor;
}

function money(value: string | number) {
  const minor = Number(value);
  if (!Number.isSafeInteger(minor)) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);
}

export default function GastroFinancePage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [direction, setDirection] = useState('all');
  const [status, setStatus] = useState('all');
  const [settling, setSettling] = useState<Entry | null>(null);
  const [reversing, setReversing] = useState<Movement | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (workspaceId = workspace) => {
    if (!workspaceId) { setEntries([]); setMovements([]); return; }
    const [entryRows, movementRows] = await Promise.all([
      api<Entry[]>(`/gastro-finance/workspaces/${workspaceId}/entries?direction=${direction}&status=${status}&limit=300`),
      api<Movement[]>(`/gastro-finance/workspaces/${workspaceId}/movements?limit=300`),
    ]);
    setEntries(entryRows);
    setMovements(movementRows);
  }, [workspace, direction, status]);

  useEffect(() => {
    if (!getToken()) return;
    let active = true;
    Promise.all([api<User>('/auth/me'), api<Workspace[]>('/workspaces')]).then(([account, spaces]) => {
      if (!active) return;
      setUser(account);
      setWorkspaces(spaces);
      setWorkspace(spaces[0]?.id || '');
    }).catch(reason => { if (active) setError((reason as Error).message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch(reason => setError((reason as Error).message)); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function action(callback: () => Promise<unknown>, success: string, reset?: () => void) {
    setBusy(true); setError(''); setMessage('');
    try { await callback(); if (reset) reset(); await load(); setMessage(success); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <AccessShell user={user} title="Financeiro administrativo">
    <p className="text-sm text-[#44546f]">Controle interno de contas a pagar e receber, liquidações parciais e estornos registrados. Valores são BRL em centavos; não há dados de pacientes, emissão fiscal ou convênios neste módulo.</p>
    <p className="rounded-lg border border-[#e2b866] bg-[#fff8e6] p-3 text-sm text-[#6b4d0f]">Este módulo registra movimentações administrativas e não substitui escrituração contábil ou emissão fiscal.</p>
    {error && <p role="alert" className="rounded-lg bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-[#dcfff1] p-3 text-sm">{message}</p>}
    <section className={accessPanel}>
      <label className="block max-w-xl text-sm font-semibold">Workspace
        <select aria-label="Selecionar workspace financeiro" className={field} value={workspace} onChange={event => setWorkspace(event.target.value)}>
          <option value="">Selecione um workspace</option>
          {workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    </section>

    {workspace && <>
      <section className={`${accessPanel} space-y-3`}>
        <div><h2 className="text-lg font-bold">Novo lançamento</h2><p className="text-sm text-[#626f86]">Um lançamento é imutável. Para corrigir antes de liquidar, anule-o e crie outro.</p></div>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={event => {
          event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
          let amountMinor: number;
          try { amountMinor = parseAmount(String(data.get('amount') || '')); } catch (reason) { setError((reason as Error).message); return; }
          void action(async () => { await send(`/gastro-finance/workspaces/${workspace}/entries`, 'POST', { direction: data.get('direction'), category: data.get('category'), amount_minor: amountMinor, due_on: data.get('due_on') || undefined, operation_key: crypto.randomUUID() }); }, 'Lançamento criado.', () => form.reset());
        }}>
          <label className="text-sm">Tipo<select required name="direction" className={field}><option value="receivable">A receber</option><option value="payable">A pagar</option></select></label>
          <label className="text-sm">Categoria<select required name="category" className={field}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-sm">Valor (R$)<input required name="amount" inputMode="decimal" autoComplete="off" placeholder="0,00" className={field}/></label>
          <label className="text-sm">Vencimento<input name="due_on" type="date" className={field}/></label>
          <button disabled={busy} className={`${accessButton} self-end`}>Criar lançamento</button>
        </form>
      </section>

      <section className={`${accessPanel} space-y-4`}>
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold">Lançamentos</h2><p className="text-sm text-[#626f86]">O saldo em aberto é calculado no servidor pelas liquidações e estornos registrados.</p></div>
          <div className="flex flex-wrap gap-2"><label className="text-sm">Tipo<select aria-label="Filtrar tipo de lançamento" className={field} value={direction} onChange={event => setDirection(event.target.value)}><option value="all">Todos</option><option value="receivable">A receber</option><option value="payable">A pagar</option></select></label>
            <label className="text-sm">Situação<select aria-label="Filtrar situação" className={field} value={status} onChange={event => setStatus(event.target.value)}><option value="all">Todas</option><option value="open">Em aberto</option><option value="partial">Parcial</option><option value="settled">Liquidado</option><option value="void">Anulado</option></select></label></div>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[820px] border-collapse text-left text-sm"><thead><tr className="border-b"><th className="p-2">Criado</th><th className="p-2">Tipo</th><th className="p-2">Categoria</th><th className="p-2">Vencimento</th><th className="p-2">Valor</th><th className="p-2">Liquidado</th><th className="p-2">Saldo</th><th className="p-2">Situação</th><th className="p-2">Ação</th></tr></thead><tbody>
          {entries.map(entry => <tr key={entry.id} className="border-b"><td className="p-2">{new Date(entry.created_at).toLocaleDateString('pt-BR')}</td><td className="p-2">{entry.direction === 'receivable' ? 'A receber' : 'A pagar'}</td><td className="p-2">{categoryLabels[entry.category] || entry.category}</td><td className="p-2">{entry.due_on ? new Date(`${entry.due_on}T12:00:00`).toLocaleDateString('pt-BR') : '—'}</td><td className="p-2 tabular-nums">{money(entry.amount_minor)}</td><td className="p-2 tabular-nums">{money(entry.settled_minor)}</td><td className="p-2 tabular-nums">{money(entry.balance_minor)}</td><td className="p-2">{statusLabels[entry.status]}</td><td className="p-2"><div className="flex gap-2">{entry.status !== 'void' && Number(entry.balance_minor) > 0 && <button className="min-h-11 rounded-lg border px-3" onClick={() => setSettling(entry)}>Liquidar</button>}{entry.status === 'open' && entry.settled_minor === '0' && <button className="min-h-11 rounded-lg border border-[#ae2a19] px-3 text-[#ae2a19]" disabled={busy} onClick={() => void action(() => send(`/gastro-finance/workspaces/${workspace}/entries/${entry.id}/void`, 'POST'), 'Lançamento anulado.')}>Anular</button>}</div></td></tr>)}
        </tbody></table></div>
        {entries.length === 0 && <p className="text-sm text-[#626f86]">Nenhum lançamento neste filtro.</p>}
        {settling && <form className="grid gap-3 rounded-lg border border-[#9aaeb1] p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={event => {
          event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
          let amountMinor: number;
          try { amountMinor = parseAmount(String(data.get('amount') || '')); } catch (reason) { setError((reason as Error).message); return; }
          void action(async () => { await send(`/gastro-finance/workspaces/${workspace}/entries/${settling.id}/settlements`, 'POST', { amount_minor: amountMinor, method: data.get('method'), operation_key: crypto.randomUUID() }); }, 'Liquidação registrada.', () => setSettling(null));
        }}><h3 className="font-semibold sm:col-span-2 lg:col-span-4">Liquidar lançamento · saldo {money(settling.balance_minor)}</h3>
          <label className="text-sm">Valor (R$)<input required name="amount" inputMode="decimal" autoComplete="off" placeholder="0,00" className={field}/></label><label className="text-sm">Forma<select name="method" className={field}>{Object.entries(methodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <button disabled={busy} className={`${accessButton} self-end`}>Registrar liquidação</button><button type="button" className="min-h-11 rounded-lg border px-4" onClick={() => setSettling(null)}>Cancelar</button>
        </form>}
      </section>

      <section className={`${accessPanel} space-y-4`}>
        <div><h2 className="text-lg font-bold">Histórico de liquidações</h2><p className="text-sm text-[#626f86]">Eventos são imutáveis. Estornos acrescentam uma linha de reversão, sem apagar o pagamento original.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-left text-sm"><thead><tr className="border-b"><th className="p-2">Data</th><th className="p-2">Lançamento</th><th className="p-2">Evento</th><th className="p-2">Valor</th><th className="p-2">Forma</th><th className="p-2">Motivo</th><th className="p-2">Ação</th></tr></thead><tbody>
          {movements.map(movement => <tr key={movement.id} className="border-b"><td className="p-2">{new Date(movement.created_at).toLocaleString('pt-BR')}</td><td className="p-2">{movement.direction === 'receivable' ? 'A receber' : 'A pagar'} · {categoryLabels[movement.category] || movement.category}</td><td className="p-2">{movement.movement_type === 'settlement' ? 'Liquidação' : 'Estorno'}</td><td className="p-2 tabular-nums">{money(movement.amount_minor)}</td><td className="p-2">{methodLabels[movement.method] || movement.method}</td><td className="p-2">{movement.reversal_reason ? reversalLabels[movement.reversal_reason] || movement.reversal_reason : '—'}</td><td className="p-2">{movement.movement_type === 'settlement' && !movement.is_reversed && <button className="min-h-11 rounded-lg border px-3" onClick={() => setReversing(movement)}>Estornar</button>}</td></tr>)}
        </tbody></table></div>
        {movements.length === 0 && <p className="text-sm text-[#626f86]">Ainda não há liquidações.</p>}
        {reversing && <form className="grid gap-3 rounded-lg border border-[#9aaeb1] p-4 sm:grid-cols-3" onSubmit={event => {
          event.preventDefault(); const data = new FormData(event.currentTarget);
          void action(() => send(`/gastro-finance/workspaces/${workspace}/movements/${reversing.id}/reversal`, 'POST', { reason: data.get('reason'), operation_key: crypto.randomUUID() }), 'Estorno registrado como novo evento.', () => setReversing(null));
        }}><h3 className="font-semibold sm:col-span-3">Estornar liquidação de {money(reversing.amount_minor)}</h3><label className="text-sm">Motivo<select name="reason" className={field}>{Object.entries(reversalLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button disabled={busy} className={`${accessButton} self-end`}>Confirmar estorno</button><button type="button" className="min-h-11 rounded-lg border px-4" onClick={() => setReversing(null)}>Cancelar</button></form>}
      </section>
    </>}
  </AccessShell>;
}
