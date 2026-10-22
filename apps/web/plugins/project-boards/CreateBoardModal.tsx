'use client';
import {useState} from 'react';
import {Modal} from '@/components/ui';
import {boardColors} from '@/lib/api';
import {useCreationAvailability} from './use-creation-availability';

export function CreateBoardModal({ onClose, onCreate }: { onClose:()=>void; onCreate:(title:string,background:string,workspaceId?:string)=>Promise<void> }) {
  const {canCreateBoard}=useCreationAvailability();
  const [title,setTitle]=useState('');
  const [background,setBackground]=useState('blue');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function create(event: React.FormEvent) {
    event.preventDefault(); if (!title.trim()) return;
    setBusy(true); setError('');
    try { await onCreate(title,background); onClose(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  if(!canCreateBoard)return null;
  return <Modal onClose={onClose}><form onSubmit={create} className="p-6"><h2 className="mb-5 text-center text-sm font-bold">Criar quadro</h2>
    <div className="mx-auto mb-5 flex h-28 max-w-[240px] items-center justify-center rounded text-xl font-bold text-white shadow" style={{background:boardColors[background]}}>▦</div>
    <p className="mb-2 text-xs font-bold">Plano de fundo</p><div className="mb-5 grid grid-cols-8 gap-1.5">{Object.entries(boardColors).map(([key,color]) => <button type="button" key={key} onClick={() => setBackground(key)} aria-label={key} className={`h-8 rounded ${background===key?'ring-2 ring-[#0c66e4] ring-offset-2':''}`} style={{background:color}}/>)}</div>
    <label className="mb-2 block text-xs font-bold" htmlFor="board-title">Título do quadro <span className="text-red-500">*</span></label><input id="board-title" autoFocus maxLength={160} value={title} onChange={e=>setTitle(e.target.value)} className="mb-4 w-full rounded border border-[#8590a2] px-3 py-2 text-sm" placeholder="Ex.: Projeto de lançamento"/>
    {error && <p role="alert" className="mb-3 rounded bg-[#ffebe6] p-2 text-xs text-[#ae2a19]">{error}</p>}
    <button disabled={busy || !title.trim()} className="w-full rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0055cc]">{busy ? 'Criando...' : 'Criar quadro'}</button>
  </form></Modal>;
}
