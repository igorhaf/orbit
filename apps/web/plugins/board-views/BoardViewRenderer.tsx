'use client';
import {Columns3,ListTree} from 'lucide-react';
import type {BoardView,BoardViewProps} from './contract';
import {StructuredBoardView} from './StructuredBoardView';

function VisualBoardView({children}:BoardViewProps){return <div data-board-view="board" className="board-scroll flex min-h-0 flex-1 items-start gap-3 overflow-x-auto overflow-y-hidden p-3 pb-5 sm:p-5">{children}</div>}
const renderers={board:VisualBoardView,structured:StructuredBoardView};
export const supportedBoardViews=(views:BoardView[])=>views.filter(view=>view.renderer in renderers);
export function BoardViewSelector({views,current,busy,onChange}:{views:BoardView[];current:string|null;busy:boolean;onChange:(viewId:string)=>void}){
  if(views.length<2)return null;
  return <label className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg bg-white/20 px-2 text-sm"><span className="sr-only">Visualização do quadro</span>{current==='structured'?<ListTree size={17}/>:<Columns3 size={17}/>}<select aria-label="Visualização do quadro" disabled={busy} value={current||''} onChange={event=>onChange(event.target.value)} className="min-h-11 min-w-0 max-w-48 rounded bg-transparent pr-2 text-sm font-semibold text-inherit">{views.map(view=><option key={view.id} value={view.id} className="text-[#172b4d]">{view.name}</option>)}</select></label>;
}
export function BoardViewRenderer({view,...props}:BoardViewProps&{view:BoardView|undefined}){
  if(!view)return <div role="status" className="m-4 rounded-lg bg-white p-6 text-sm text-[#172b4d]">Nenhuma visualização está disponível para seu perfil. Solicite acesso ao administrador.</div>;
  const Renderer=renderers[view.renderer as keyof typeof renderers];
  return Renderer?<Renderer {...props}/>:null;
}
