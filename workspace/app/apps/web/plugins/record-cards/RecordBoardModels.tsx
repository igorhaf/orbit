'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,send,cardUrl,type RecordBoardScope} from '@/lib/api';
import {usePluginAvailability} from '@/lib/plugin-availability';
export function useRecordBoardScope(board?:string){
 const availability=usePluginAvailability();const active=availability.enabled('record-cards')&&availability.hasRecordCards;
 const [loaded,setLoaded]=useState<{id:string;scope:RecordBoardScope|null}|null>(null);
 useEffect(()=>{if(!board||!active)return;let live=true;api<RecordBoardScope|null>(`/record-cards/boards/${board}`).then(scope=>{if(live)setLoaded({id:board,scope})}).catch(()=>{if(live)setLoaded({id:board,scope:null})});return()=>{live=false}},[board,active]);
 return active&&loaded?.id===board?loaded?.scope:null;
}
export function RecordBoardModels({scope}:{scope:RecordBoardScope}){
 const router=useRouter();const [busy,setBusy]=useState(''),[error,setError]=useState('');
 async function create(template:string){setBusy(template);setError('');try{const card=await send<{id:string;url_token:string}>(`/record-cards/boards/${scope.board_id}/templates/${template}`,'POST',{operation_key:crypto.randomUUID()});window.dispatchEvent(new Event('data:changed'));router.push(cardUrl(scope.board_id,card.id,card.url_token))}catch(error){setError((error as Error).message)}finally{setBusy('')}}
 return <section aria-label="Modelos deste quadro" className="min-w-0 space-y-3"><div><h2 className="font-bold">Modelos deste quadro</h2><p className="text-xs text-[#626f86]">Crie uma atividade com descrição e checklist na fase prevista.</p></div>{error&&<p role="alert" className="text-sm text-[#ae2a19]">{error}</p>}{scope.templates.map(template=><article key={template.id} className="rounded-lg border p-3"><strong className="block break-words text-sm">{template.name}</strong><p className="my-2 text-xs text-[#626f86]">{scope.phases.find(phase=>phase.id===template.phase)?.label} · {template.checklist.length} itens</p><details><summary className="min-h-11 cursor-pointer py-2 text-xs">Ver descrição e checklist</summary><p className="whitespace-pre-wrap break-words text-xs">{template.description}</p><ul className="mt-2 list-disc space-y-1 pl-4 text-xs">{template.checklist.map((item,index)=><li key={index}>{item}</li>)}</ul></details>{scope.can_write&&<button disabled={Boolean(busy)} onClick={()=>void create(template.id)} className="min-h-11 w-full rounded-lg bg-[#0c66e4] px-3 text-sm font-semibold text-white disabled:opacity-50">{busy===template.id?'Criando…':'Usar modelo'}</button>}</article>)}</section>;
}
