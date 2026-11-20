'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getToken, send, User, Workspace } from '@/lib/api';
import { AccessShell, accessButton, accessInput, accessPanel } from '@/components/access-shell';

type Product = { id: string; code: string | null; name: string; unit: string; tracks_lots: boolean; current_balance: number; lot_balance: number; next_expiry: string | null; expired_lots: number; expiring_lots: number };
type Lot = { id: string; code: string; expires_on: string | null; current_balance: number };
type Movement = { id: string; direction: 'entry' | 'exit'; quantity: number; product_name: string; product_code: string | null; unit: string; lot_code: string | null; expires_on: string | null; actor_name: string; created_at: string };
const field = accessInput;

export default function GastroInventoryPage() {
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [lotsProductId, setLotsProductId] = useState('');
  const [productId, setProductId] = useState('');
  const [editingProduct, setEditingProduct] = useState(false);
  const [direction, setDirection] = useState<'entry' | 'exit'>('entry');
  const [availability, setAvailability] = useState('all');
  const [expiry, setExpiry] = useState('all');
  const [directionFilter, setDirectionFilter] = useState('all');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedProduct = useMemo(() => products.find(product => product.id === productId) || null, [products, productId]);
  const load = useCallback(async (space = workspace) => {
    if (!space) return;
    const [inventory, history] = await Promise.all([
      api<Product[]>(`/gastro-inventory/workspaces/${space}/products?availability=${availability}&expiry=${expiry}`),
      api<Movement[]>(`/gastro-inventory/workspaces/${space}/movements?direction=${directionFilter}&limit=100`),
    ]);
    setProducts(inventory);
    setMovements(history);
    if (productId && !inventory.some(product => product.id === productId)) setProductId('');
  }, [workspace, availability, expiry, directionFilter, productId]);

  useEffect(() => {
    if (!getToken()) return;
    let alive = true;
    Promise.all([api<User>('/auth/me'), api<Workspace[]>('/workspaces')]).then(([account, spaces]) => {
      if (!alive) return;
      setUser(account);
      setWorkspaces(spaces);
      setWorkspace(spaces[0]?.id || '');
    }).catch(reason => { if (alive) setError((reason as Error).message); });
    return () => { alive = false; };
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void load().catch(reason => setError((reason as Error).message)); }, 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    if (!productId) return;
    void api<Lot[]>(`/gastro-inventory/products/${productId}/lots`).then(rows => { setLots(rows); setLotsProductId(productId); }).catch(reason => setError((reason as Error).message));
  }, [productId, movements]);

  async function action(callback: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setMessage('');
    try { await callback(); await load(); setMessage(success); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <AccessShell user={user} title="Estoque">
    <p className="text-sm text-[#44546f]">Produtos, lotes e histórico de movimentos. O saldo é atualizado junto com cada movimento.</p>
    {error && <p role="alert" className="rounded-lg bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-[#dcfff1] p-3 text-sm">{message}</p>}
    <section className={accessPanel}>
      <label className="block max-w-xl text-sm font-semibold">Espaço de trabalho
        <select className={field} value={workspace} onChange={event => setWorkspace(event.target.value)}>
          <option value="">Selecione um workspace</option>
          {workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    </section>

    {workspace && <>
      <section className={`${accessPanel} space-y-4`}>
        <h2 className="text-lg font-bold">Cadastrar produto</h2>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={event => {
          event.preventDefault(); const data = new FormData(event.currentTarget);
          const form = event.currentTarget;
          void action(async () => { await send(`/gastro-inventory/workspaces/${workspace}/products`, 'POST', { name: data.get('name'), code: data.get('code'), unit: data.get('unit'), tracks_lots: data.get('tracks_lots') === 'on' }); form.reset(); }, 'Produto cadastrado.');
        }}>
          <label className="text-sm">Produto<input required name="name" maxLength={120} className={field}/></label>
          <label className="text-sm">Código<input name="code" maxLength={32} className={field}/></label>
          <label className="text-sm">Unidade<input required name="unit" maxLength={40} className={field}/></label>
          <label className="flex min-h-11 items-center gap-2 pt-5 text-sm"><input name="tracks_lots" type="checkbox"/> Controla por lote</label>
          <button disabled={busy} className={`${accessButton} self-end`}>Salvar produto</button>
        </form>
      </section>

      <section className={`${accessPanel} space-y-4`}>
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold">Produtos</h2><p className="text-sm">Saldo atual e lotes com validade.</p></div>
          <div className="flex flex-wrap gap-2"><label className="text-sm">Disponibilidade<select className={field} value={availability} onChange={event => setAvailability(event.target.value)}><option value="all">Todos</option><option value="available">Com saldo</option><option value="empty">Sem saldo</option></select></label>
            <label className="text-sm">Validade<select className={field} value={expiry} onChange={event => setExpiry(event.target.value)}><option value="all">Todas</option><option value="30days">Vencem em 30 dias</option><option value="expired">Vencidas</option></select></label></div>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[680px] border-collapse text-left text-sm"><thead><tr className="border-b"><th className="p-2">Produto</th><th className="p-2">Código</th><th className="p-2">Saldo</th><th className="p-2">Lotes</th><th className="p-2">Validade</th><th className="p-2">Ação</th></tr></thead>
          <tbody>{products.map(product => <tr key={product.id} className="border-b"><td className="p-2 font-medium">{product.name}</td><td className="p-2">{product.code || '—'}</td><td className="p-2">{product.current_balance} {product.unit}</td><td className="p-2">{product.tracks_lots ? `${product.lot_balance} · ${product.expired_lots} vencido(s)` : 'Não controlado'}</td><td className="p-2">{product.next_expiry ? new Date(`${product.next_expiry}T12:00:00`).toLocaleDateString('pt-BR') : '—'}</td><td className="p-2"><div className="flex flex-wrap gap-2"><button className="min-h-11 rounded-lg border px-3" onClick={() => { setProductId(product.id); setEditingProduct(true); }}>Editar</button><button className="min-h-11 rounded-lg border px-3" onClick={() => { setProductId(product.id); setEditingProduct(false); }}>Movimentar</button></div></td></tr>)}</tbody>
        </table></div>
        {products.length === 0 && <p className="text-sm text-[#626f86]">Nenhum produto para estes filtros.</p>}
        {selectedProduct && editingProduct && <form key={selectedProduct.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={event => {
          event.preventDefault(); const data = new FormData(event.currentTarget);
          void action(async () => { await send(`/gastro-inventory/products/${selectedProduct.id}`, 'PATCH', { name: data.get('name'), code: data.get('code'), unit: data.get('unit'), tracks_lots: data.get('tracks_lots') === 'on' }); setEditingProduct(false); }, 'Produto atualizado.');
        }}><h3 className="sm:col-span-2 lg:col-span-5 font-semibold">Editar {selectedProduct.name}</h3>
          <label className="text-sm">Produto<input required name="name" maxLength={120} defaultValue={selectedProduct.name} className={field}/></label><label className="text-sm">Código<input name="code" maxLength={32} defaultValue={selectedProduct.code || ''} className={field}/></label><label className="text-sm">Unidade<input required name="unit" maxLength={40} defaultValue={selectedProduct.unit} className={field}/></label>
          <label className="flex min-h-11 items-center gap-2 pt-5 text-sm"><input name="tracks_lots" type="checkbox" defaultChecked={selectedProduct.tracks_lots}/> Controla por lote</label><button disabled={busy} className={`${accessButton} self-end`}>Salvar alterações</button>
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-5"><button type="button" disabled={busy || selectedProduct.current_balance !== 0} className="min-h-11 rounded-lg border border-[#ae2a19] px-3 text-[#ae2a19] disabled:opacity-50" onClick={() => void action(async () => { await send(`/gastro-inventory/products/${selectedProduct.id}/archive`, 'POST'); setEditingProduct(false); setProductId(''); }, 'Produto arquivado; histórico preservado.')}>Arquivar produto</button><span className="text-sm text-[#626f86]">O produto só pode ser arquivado com saldo zero. Movimentos anteriores permanecem no histórico.</span></div>
        </form>}
      </section>

      <section className={`${accessPanel} space-y-4`}>
        <h2 className="text-lg font-bold">Registrar movimento</h2>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={event => {
          event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
          void action(async () => {
            await send(`/gastro-inventory/workspaces/${workspace}/movements`, 'POST', { product_id: data.get('product_id'), direction, quantity: Number(data.get('quantity')), operation_key: crypto.randomUUID(), ...(direction === 'entry' && selectedProduct?.tracks_lots ? { lot_code: data.get('lot_code'), expires_on: data.get('expires_on') || undefined } : {}), ...(direction === 'exit' && selectedProduct?.tracks_lots ? { lot_id: data.get('lot_id') } : {}) });
            form.reset(); setProductId('');
          }, direction === 'entry' ? 'Entrada registrada.' : 'Saída registrada.');
        }}>
          <label className="text-sm">Produto<select required name="product_id" className={field} value={productId} onChange={event => setProductId(event.target.value)}><option value="">Selecione</option>{products.map(product => <option key={product.id} value={product.id}>{product.name} · saldo {product.current_balance}</option>)}</select></label>
          <label className="text-sm">Movimento<select name="direction" className={field} value={direction} onChange={event => setDirection(event.target.value as 'entry' | 'exit')}><option value="entry">Entrada</option><option value="exit">Saída</option></select></label>
          <label className="text-sm">Quantidade<input required name="quantity" type="number" min="1" step="1" className={field}/></label>
          {selectedProduct?.tracks_lots && direction === 'entry' && <>
            <label className="text-sm">Código do lote<input required name="lot_code" maxLength={80} className={field}/></label>
            <label className="text-sm">Validade<input name="expires_on" type="date" className={field}/></label>
          </>}
          {selectedProduct?.tracks_lots && direction === 'exit' && <label className="text-sm">Lote para saída<select required name="lot_id" className={field}><option value="">Selecione</option>{(lotsProductId === productId ? lots : []).filter(lot => lot.current_balance > 0).map(lot => <option key={lot.id} value={lot.id}>{lot.code} · {lot.current_balance} · {lot.expires_on || 'sem validade'}</option>)}</select></label>}
          <button disabled={busy || !selectedProduct} className={`${accessButton} self-end`}>Registrar</button>
        </form>
      </section>

      <section className={`${accessPanel} space-y-4`}>
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold">Histórico</h2><p className="text-sm">Os movimentos registrados não são editáveis nem removidos.</p></div>
          <label className="text-sm">Tipo<select className={field} value={directionFilter} onChange={event => setDirectionFilter(event.target.value)}><option value="all">Todos</option><option value="entry">Entradas</option><option value="exit">Saídas</option></select></label></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[680px] border-collapse text-left text-sm"><thead><tr className="border-b"><th className="p-2">Data</th><th className="p-2">Movimento</th><th className="p-2">Produto</th><th className="p-2">Lote</th><th className="p-2">Quantidade</th><th className="p-2">Responsável</th></tr></thead><tbody>
          {movements.map(item => <tr key={item.id} className="border-b"><td className="p-2">{new Date(item.created_at).toLocaleString('pt-BR')}</td><td className="p-2">{item.direction === 'entry' ? 'Entrada' : 'Saída'}</td><td className="p-2">{item.product_name}</td><td className="p-2">{item.lot_code || '—'}</td><td className="p-2">{item.quantity} {item.unit}</td><td className="p-2">{item.actor_name}</td></tr>)}
        </tbody></table></div>{movements.length === 0 && <p className="text-sm text-[#626f86]">Ainda não há movimentos.</p>}
      </section>
    </>}
  </AccessShell>;
}
