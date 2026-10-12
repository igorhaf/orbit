'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, Board, Card, CardExtensions } from '@/lib/api';
import { CardChecklists } from './card-checklists';
import { GitActivity, GitCardSection } from './git-card-panel';
import { CardContexts } from './card-contexts';

export function CardChecklistSection({card,board,onChanged}: {card:Card;board:Board;onChanged:()=>Promise<void>}){
  const [data,setData]=useState<CardExtensions|null>(null);
  const [error,setError]=useState('');
  const load=useCallback(async()=>setData(await api<CardExtensions>('/cards/'+card.id+'/extensions')),[card.id]);
  useEffect(()=>{api<CardExtensions>('/cards/'+card.id+'/extensions').then(setData).catch(error=>setError((error as Error).message))},[card.id]);
  useEffect(()=>{const refresh=(event:Event)=>{if((event as CustomEvent<string>).detail===card.id)void load().catch(error=>setError((error as Error).message))};window.addEventListener('orbit:card-details-changed',refresh);return()=>window.removeEventListener('orbit:card-details-changed',refresh)},[card.id,load]);
  async function mutate(action:()=>Promise<unknown>){try{await action();await Promise.all([load(),onChanged()]);setError('')}catch(error){setError((error as Error).message)}}
  return <div className="space-y-7">{error&&<p role="alert" className="rounded bg-[#ffebe6] p-2 text-sm text-[#ae2a19]">{error}</p>}{data&&<CardChecklists card={card} board={board} groups={data.checklists} mutate={mutate}/>}</div>;
}

export function CardSections({card,board,onChanged}: {card:Card;board:Board;onChanged:()=>Promise<void>}){
  const projectId=card.ai_project_id||board.ai_default_project_id||'';
  return <div className="space-y-7"><GitActivity cardId={card.id}/><GitCardSection cardId={card.id} projectId={projectId}/><CardContexts key={`contexts:${card.id}`} card={card} board={board} onChanged={onChanged}/></div>;
}
