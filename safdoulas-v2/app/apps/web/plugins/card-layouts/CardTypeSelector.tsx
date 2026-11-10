"use client";
import {useEffect,useState} from 'react';
import {api,send} from '@/lib/api';

type TypeState={types:Array<{id:string;name:string}>;requiresSelection:boolean;currentTypeId:string|null};
export function CardTypeSelector({cardId,onChanged}:{cardId:string;onChanged:()=>void|Promise<void>}){
 const [state,setState]=useState<TypeState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;void api<TypeState>(`/cards/${cardId}/type`).then(value=>{if(active)setState(value)}).catch(reason=>{if(active)setError((reason as Error).message)});return()=>{active=false}},[cardId]);
 if(!state||!state.requiresSelection)return error?<p role="alert" className="mb-3 text-xs text-[#ae2a19]">{error}</p>:null;
 return <div className="mb-4 rounded-lg border border-[#dfe1e6] p-3"><label className="block text-sm font-semibold">Tipo de cartão<select aria-label="Tipo de cartão" value={state.currentTypeId||''} disabled={busy} onChange={event=>{const typeId=event.target.value;if(!typeId)return;setBusy(true);void send<TypeState>(`/cards/${cardId}/type`,'PATCH',{typeId}).then(value=>{setState(value);return onChanged()}).catch(reason=>setError((reason as Error).message)).finally(()=>setBusy(false))}} className="mt-1 min-h-11 w-full rounded-lg border border-[#8590a2] bg-white px-3 font-normal"><option value="">Escolha um tipo</option>{state.types.map(type=><option key={type.id} value={type.id}>{type.name}</option>)}</select></label>{error&&<p role="alert" className="mt-2 text-xs text-[#ae2a19]">{error}</p>}</div>;
}
