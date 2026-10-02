'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, DatabaseBackup, HardDrive, History, LoaderCircle, RotateCcw } from 'lucide-react';
import { api, getToken, send, User, Board } from '@/lib/api';
import { AppHeader, useConfirmModal, WorkspaceSidebar } from '@/components/ui';

type Backup = {archive:string;created_at?:string;reason?:string;database?:string;archive_bytes?:number;invalid_manifest?:boolean};
type RestoreResult = {manifest?:{archive:string};counts?:{users:number;boards:number;cards:number;attachments:number}};

export default function BackupsPage(){
  const router=useRouter();
  const { confirm, confirmationModal } = useConfirmModal();
  const [user,setUser]=useState<User|null>(null);
  const [boards,setBoards]=useState<Board[]>([]);
  const [backups,setBackups]=useState<Backup[]>([]);
  const [busy,setBusy]=useState(false);
  const [restoring,setRestoring]=useState('');
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const load=useCallback(async()=>{try{const [account,all,rows]=await Promise.all([api<User>('/auth/me'),api<Board[]>('/boards'),api<Backup[]>('/backups')]);setUser(account);setBoards(all);setBackups(rows);setError('')}catch(reason){setError((reason as Error).message)}},[]);
  useEffect(()=>{if(!getToken()){router.replace('/');return}const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load,router]);
  async function create(){setBusy(true);setError('');setMessage('');try{const backup=await send<Backup>('/backups','POST');setMessage(`Backup criado: ${backup.archive}`);await load()}catch(reason){setError((reason as Error).message)}finally{setBusy(false)}}
  function restore(backup:Backup){if(backup.invalid_manifest)return;confirm({title:'Restaurar backup',description:`Restaurar ${backup.archive} em um banco novo e vazio configurado para recuperação?`,confirmLabel:'Restaurar',destructive:false},async()=>{setRestoring(backup.archive);setError('');setMessage('');try{const result=await send<RestoreResult>(`/backups/${encodeURIComponent(backup.archive)}/restore`,'POST');const counts=result.counts;setMessage(counts?`Backup restaurado em banco separado. ${counts.users} usuários, ${counts.boards} quadros e ${counts.cards} cartões restaurados. Valide o destino e altere a conexão da aplicação quando estiver pronto.`:'Backup restaurado em banco separado. Valide o destino antes de alterar a conexão da aplicação.')}catch(reason){setError((reason as Error).message)}finally{setRestoring('')}})}
  return <div className="flex min-h-screen flex-col bg-[#f7f8fa]"><AppHeader user={user} boards={boards}/><div className="flex min-h-0 flex-1"><WorkspaceSidebar boards={boards} onCreate={()=>router.push('/boards?create=1')} onChoose={id=>router.push(id?`/board/${id}`:'/boards')}/><main className="mx-auto w-full max-w-[1000px] flex-1 p-5 sm:p-8"><button onClick={()=>router.push('/')} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[#44546f] hover:text-[#0c66e4]"><ArrowLeft size={16}/> Início</button><div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#eeedfd] text-[#403294]"><DatabaseBackup size={22}/></span><div><h1 className="text-2xl font-bold">Backups</h1><p className="text-sm text-[#626f86]">Crie cópias e prepare a recuperação dos seus dados.</p></div></div><button disabled={busy} onClick={()=>void create()} className="inline-flex items-center gap-2 rounded bg-[#403294] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy?<LoaderCircle size={16} className="animate-spin"/>:<DatabaseBackup size={16}/>} Criar backup manual</button></div>
    <div className="mb-5 flex gap-3 rounded-lg border border-[#b3d4ff] bg-[#e9f2ff] p-4 text-sm text-[#344563]"><HardDrive size={18} className="mt-0.5 shrink-0 text-[#0c66e4]"/><p>Por segurança, a restauração usa um banco novo e vazio definido por <code>ORBIT_RESTORE_DATABASE_URL</code>. Depois de conferir os dados restaurados, atualize a conexão da aplicação para esse destino.</p></div>
    {error&&<p role="alert" className="mb-4 rounded bg-[#ffebe6] p-3 text-sm text-[#ae2a19]">{error}</p>}{message&&<p role="status" className="mb-4 rounded bg-[#dffcf0] p-3 text-sm text-[#216e4e]">{message}</p>}
    <section className="overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-sm"><div className="border-b border-[#dfe1e6] px-5 py-4"><h2 className="flex items-center gap-2 font-bold"><History size={18}/> Backups disponíveis</h2></div>{backups.length?backups.map(backup=><article key={backup.archive} className="flex flex-wrap items-center gap-3 border-b border-[#f1f2f4] px-5 py-4 last:border-0"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#f1f2f4] text-[#626f86]"><DatabaseBackup size={17}/></span><div className="min-w-0 flex-1"><strong className="block break-all text-sm">{backup.archive}</strong><span className="mt-1 block text-xs text-[#626f86]">{backup.created_at?new Date(backup.created_at).toLocaleString('pt-BR'):'Manifesto indisponível'}{backup.archive_bytes?` · ${(backup.archive_bytes/1024/1024).toFixed(1)} MB`:''}{backup.reason?` · ${backup.reason}`:''}</span></div><button disabled={backup.invalid_manifest||Boolean(restoring)} onClick={()=>void restore(backup)} className="inline-flex items-center gap-1.5 rounded bg-[#e9f2ff] px-3 py-2 text-xs font-semibold text-[#0c66e4] disabled:opacity-40">{restoring===backup.archive?<LoaderCircle size={14} className="animate-spin"/>:<RotateCcw size={14}/>} Restaurar</button></article>):<p className="p-10 text-center text-sm text-[#626f86]">Ainda não há backups locais. Use “Criar backup manual” para criar o primeiro.</p>}</section>
  </main></div>{confirmationModal}</div>;
}
