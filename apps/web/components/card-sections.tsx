'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, Board, Card, CardExtensions } from '@/lib/api';
import { CardChecklists } from './card-checklists';
import { CardCustomFields } from './card-custom-fields';

export function CardSections({card,board,onChanged}: {card:Card;board:Board;onChanged:()=>Promise<void>}){
  const [data,setData]=useState<CardExtensions|null>(null);
  const [error,setError]=useState('');
  const load=useCallback(async()=>setData(await api<CardExtensions>('/cards/'+card.id+'/extensions')),[card.id]);
  useEffect(()=>{api<CardExtensions>('/cards/'+card.id+'/extensions').then(setData).catch(error=>setError((error as Error).message))},[card.id]);
  async function mutate(action:()=>Promise<unknown>){try{await action();await Promise.all([load(),onChanged()]);setError('')}catch(error){setError((error as Error).message)}}
  return <div className="space-y-7">{error&&<p role="alert" className="rounded bg-[#ffebe6] p-2 text-sm text-[#ae2a19]">{error}</p>}{data&&<><CardChecklists card={card} board={board} groups={data.checklists} mutate={mutate}/><CardCustomFields card={card} board={board} values={data.values} mutate={mutate}/></>}</div>;
}
