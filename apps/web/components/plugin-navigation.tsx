'use client';
import {useEffect,useRef,useState} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {ChevronDown} from 'lucide-react';
import type {NavigationMenu,PluginNavigationLink} from '@/lib/plugin-navigation';

type Props={menus:NavigationMenu[];standalone:PluginNavigationLink[];mobile?:boolean;onNavigate?:()=>void};
export function PluginNavigation({menus,standalone,mobile=false,onNavigate}:Props){
 const router=useRouter(),pathname=usePathname();const [open,setOpen]=useState<string|null>(null);const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(null)};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){const trigger=root.current?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]');setOpen(null);trigger?.focus()}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)};
 },[]);
 const navigate=(href:string)=>{setOpen(null);onNavigate?.();router.push(href)};
 const link=(item:PluginNavigationLink)=><button key={item.id} type="button" aria-current={pathname===item.href?'page':undefined} onClick={()=>navigate(item.href)} className={`flex min-h-11 w-full min-w-0 items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-[#f1f2f4] focus-visible:outline-2 focus-visible:outline-[#0c66e4] ${pathname===item.href?'bg-[#e9f2ff] font-semibold text-[#0c66e4]':''}`}><span className="break-words">{item.label}</span></button>;
 const sections=(menu:NavigationMenu)=><>{menu.sections.map(section=><section key={section.id} className="min-w-0">{section.label&&<h3 className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-[#626f86]">{section.label}</h3>}{section.links.map(link)}</section>)}</>;
 return <div ref={root} className={mobile?'col-span-full min-w-0 border-t border-[#dfe1e6] pt-2':'flex min-w-0 items-center gap-1'}>
  {standalone.map(item=>mobile?link(item):<button type="button" key={item.id} onClick={()=>navigate(item.href)} aria-current={pathname===item.href?'page':undefined} className="min-h-11 whitespace-nowrap rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]">{item.label}</button>)}
  {menus.map(menu=>mobile?<section key={menu.id} aria-label={menu.label} className="mb-2"><h2 className="px-3 py-2 font-bold">{menu.label}</h2><div className="grid gap-2 sm:grid-cols-2">{sections(menu)}</div></section>:<div key={menu.id} className="relative">
   <button type="button" aria-expanded={open===menu.id} aria-controls={`plugin-nav-${menu.id}`} onClick={()=>setOpen(open===menu.id?null:menu.id)} className="flex min-h-11 items-center gap-1 whitespace-nowrap rounded px-3 py-2 text-sm font-semibold hover:bg-[#f1f2f4]">{menu.label}<ChevronDown size={14}/></button>
   {open===menu.id&&<nav id={`plugin-nav-${menu.id}`} aria-label={menu.label} className="fixed left-4 right-4 top-[calc(3.5rem+env(safe-area-inset-top))] z-[60] grid max-h-[70dvh] grid-cols-1 gap-3 overflow-y-auto rounded-xl border border-[#dfe1e6] bg-white p-3 shadow-dialog sm:grid-cols-2 sm:left-auto sm:w-[min(38rem,calc(100vw-2rem))]">{sections(menu)}</nav>}
  </div>)}
 </div>;
}
