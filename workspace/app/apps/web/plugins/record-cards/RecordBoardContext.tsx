'use client';
import {useState} from 'react';
import Link from 'next/link';
import {Modal} from '@/components/ui';
import ExtensionPage from '@/plugins/records/ExtensionPage';
import {send,type RecordBoardScope} from '@/lib/api';
export function RecordBoardContext({scope,onChanged}:{scope:RecordBoardScope;onChanged:()=>Promise<void>}){
 const [open,setOpen]=useState(false);
 return <section className="mb-4 space-y-3 rounded-lg border p-4"><h3 className="font-bold">{scope.label}</h3><p className="text-sm">Comentários, anexos e atividades acompanham este registro. A fase formal é alterada somente pelo fluxo autorizado.</p><div className="flex flex-wrap gap-2"><button onClick={()=>setOpen(true)} className="min-h-11 rounded-lg bg-[#0c66e4] px-3 text-sm font-semibold text-white">Registro e transições</button><Link href={scope.record_href} className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm">Dossiê e registros relacionados</Link></div>{open&&<Modal extraWide onClose={()=>setOpen(false)}><div className="max-h-[85dvh] w-full min-w-0 overflow-y-auto p-4"><ExtensionPage embedded pluginId={scope.plugin_id} workspaceId={scope.workspace_id} recordId={scope.record_id} onChanged={async()=>{await send(`/record-cards/${scope.plugin_id}/records/${scope.record_id}`,'POST',{});await onChanged()}}/></div></Modal>}</section>;
}
