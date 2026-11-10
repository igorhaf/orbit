'use client';
import { Modal } from './modal';

import dynamic from 'next/dynamic';

import { useCallback, useState } from 'react';

import { Star } from 'lucide-react';

import { Board, boardColors } from '@/lib/api';

export { Modal };

export function useConfirmModal() {
  type Options={title:string;description:string;confirmLabel?:string;destructive?:boolean};
  const [request,setRequest]=useState<{options:Options;action:()=>Promise<void>}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [restoreFocusTarget,setRestoreFocusTarget]=useState<HTMLElement|null>(null);
  const confirm=useCallback((options:Options,action:()=>Promise<void>)=>{const active=document.activeElement;setRestoreFocusTarget(active instanceof HTMLElement?active:null);setError('');setRequest({options,action})},[]);
  const close=useCallback(()=>{if(!busy)setRequest(null)},[busy]);
  const run=useCallback(async()=>{if(!request)return;setBusy(true);setError('');try{await request.action();setRequest(null)}catch(value){setError((value as Error).message)}finally{setBusy(false)}},[request]);
  const dark = process.env.NEXT_PUBLIC_ORBIT_THEME === "dark";
  const confirmationModal=request?<Modal onClose={close} title={request.options.title} restoreFocusTo={restoreFocusTarget}><div className="p-6"><h2 className="pr-8 text-lg font-bold">{request.options.title}</h2><p className={`mt-3 whitespace-pre-wrap text-sm ${dark ? 'text-[#b6c2cf]' : 'text-[#44546f]'}`}>{request.options.description}</p>{error&&<p role="alert" className={`mt-3 text-sm ${dark ? 'text-rose-300' : 'text-[#ae2a19]'}`}>{error}</p>}<div className="mt-6 flex justify-end gap-2"><button disabled={busy} onClick={close} className={`rounded px-4 py-2 text-sm font-semibold disabled:opacity-50 ${dark ? 'bg-[#80909d] text-[#11161d] hover:bg-[#a1acb5]' : 'bg-[#e9eaed] text-[#172b4d]'}`}>Cancelar</button><button disabled={busy} onClick={()=>void run()} className={`rounded px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${request.options.destructive===false?(dark?'bg-blue-600 hover:bg-blue-500':'bg-[#0c66e4]'):'bg-[#c9372c] hover:bg-[#ae2a19]'}`}>{busy?'Aguarde…':request.options.confirmLabel||'Confirmar'}</button></div></div></Modal>:null;
  return {confirm,confirmationModal};
}

export function BoardTile({ board, onClick }: { board: Board; onClick: () => void }) {
  const total = board.card_count || 0;
  return <button onClick={onClick} className="group relative flex h-[112px] w-full flex-col overflow-hidden rounded-[5px] p-3 text-left text-white shadow-sm transition hover:brightness-90" style={{background:board.background_image ? `linear-gradient(#0005,#0005),url("${board.background_image}") center/cover` : boardColors[board.background] || boardColors.blue}}>
    <span className="relative z-10 rounded bg-black/35 px-1.5 py-1 text-[10px] font-semibold">{total} cartões</span>
    <strong className="relative z-10 mt-auto max-w-[90%] truncate text-[16px] leading-5">{board.title}</strong>
    <span className="absolute -bottom-6 -right-6 h-28 w-28 rounded-full bg-white/10"/>
    <span className="absolute -top-10 right-8 h-28 w-28 rounded-full bg-white/5"/>
    {board.starred && <Star size={15} fill="currentColor" className="absolute bottom-3 right-3"/>}
  </button>;
}

export const CreateBoardModal=dynamic(()=>import('@/plugins/project-boards/CreateBoardModal').then(module=>module.CreateBoardModal));

export function EmptyHint({children}:{children:React.ReactNode}) { return <div className="rounded-lg border border-dashed border-[#c1c7d0] bg-white p-8 text-center text-sm text-[#626f86]">{children}</div>; }

export { Avatar, AppHeader, boardColorLabels, WorkspaceSidebar } from './orbit-shell-ui';
export { TransferCardModal } from './orbit-inbox-panel';
