'use client';
import {LoaderCircle, MessageCircleQuestion} from 'lucide-react';
import type {Card} from '@/lib/api';

export function CardActivityIndicator({card}:{card:Card}){
  const promptStatus=card.prompt?.status;
  const runStatus=card.result?.status;
  const active=['queued','running'].includes(promptStatus||'')||['queued','running'].includes(runStatus||'');
  const unread=Boolean(card.prompt?.unread||card.result?.unread);
  const failed=(promptStatus==='error'&&Boolean(card.prompt?.unread))||(runStatus==='failed'&&Boolean(card.result?.unread));
  if(promptStatus==='waiting_answer')return <MessageCircleQuestion aria-label="Aguardando resposta" size={14} className="shrink-0 text-[#6554c0]"/>;
  if(active)return <LoaderCircle aria-label="Atividade em andamento" size={14} className="shrink-0 animate-spin text-[#0c66e4]"/>;
  if(failed&&unread)return <span aria-label="Atividade falhou" title="Atividade falhou" className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#e5484d]"/>;
  if(unread)return <span aria-label="Atividade concluída" title="Atividade concluída" className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#0c66e4]"/>;
  return null;
}
