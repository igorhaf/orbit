'use client';
import {createContext,useContext,useEffect,useState,ReactNode} from 'react';
import Image from 'next/image';
import {api} from '@/lib/api';

export type AppBrand={app_name:string;icon_kind:'orbit'|'tree_of_life'|'custom';custom_icon_data:string|null;login_tagline:string;login_description:string;login_benefits:string[]};
const defaultBrand:AppBrand={app_name:'Orbit',icon_kind:'orbit',custom_icon_data:null,login_tagline:'Seu trabalho, com uma visão mais clara.',login_description:'Acompanhe o que vem pela frente, veja as novidades e organize seus projetos em quadros.',login_benefits:['Tarefas e prazos em destaque','Quadros, listas e cartões','Atividade e notificações em um lugar']};
const BrandContext=createContext<AppBrand>(defaultBrand);
export function BrandProvider({children}:{children:ReactNode}){
  const [brand,setBrand]=useState<AppBrand>(defaultBrand);
  useEffect(()=>{
    let alive=true;
    const refresh=()=>{api<AppBrand>('/branding').then(value=>{if(alive)setBrand(value)}).catch(()=>undefined)};
    refresh();
    window.addEventListener('orbit:branding-updated',refresh);
    return()=>{alive=false;window.removeEventListener('orbit:branding-updated',refresh)};
  },[]);
  useEffect(()=>{
    document.title=`${brand.app_name} | Organize seu trabalho`;
    let icon=document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if(!icon){icon=document.createElement('link');icon.rel='icon';document.head.appendChild(icon)}
    if(brand.icon_kind==='custom'&&brand.custom_icon_data)icon.href=brand.custom_icon_data;
    else if(brand.icon_kind==='tree_of_life')icon.href='/brand-tree-of-life.svg';
    else icon.href='/brand-orbit.svg';
  },[brand]);
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}
export function useBranding(){return useContext(BrandContext)}
export function BrandName(){const brand=useBranding();return <>{brand.app_name}</>}
export function BrandMark({className='h-8 w-8'}:{className?:string}){
  const brand=useBranding();
  if(brand.icon_kind==='custom'&&brand.custom_icon_data)return <Image src={brand.custom_icon_data} alt="" width={64} height={64} unoptimized className={`${className} rounded object-contain`} />;
  if(brand.icon_kind==='tree_of_life')return <svg viewBox="0 0 40 40" aria-hidden="true" className={`${className} rounded-lg bg-white p-0.5`}>
    <circle cx="20" cy="20" r="19" fill="#fff" stroke="#68251d" strokeWidth="1.2"/>
    <path d="M20 30c1-6 0-10 0-16m0 8c-5-2-8-5-9-9m9 12c5-3 8-6 10-11m-10 5c-3-2-4-5-4-8m4 13c-4 0-7 2-10 5m10-4c4 0 7 2 10 4m-10 1-5 5m5-5 5 5" fill="none" stroke="#74311f" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M11 13c-3-2-2-5 0-5 2 0 3 2 3 4m6 1c-3-3-1-7 1-7s4 4 1 7m7 1c0-3 2-5 4-4 1 2-1 4-4 5M13 20c-3-2-5 0-4 2 1 2 4 1 6 0m12-1c3-3 6-2 6 0-1 2-4 3-7 2" fill="#b30a50"/>
    <path d="M17 12c-3-3-6-2-5 0 1 2 3 3 6 3m9 1c3-3 6-2 5 0-1 2-3 3-6 4m-12 5-5 3m21-3 4 3" fill="#59623b"/>
  </svg>;
  return <span className={`${className} flex items-center justify-center rounded bg-[#0c66e4] text-white`}><svg viewBox="0 0 24 24" aria-hidden="true" className="h-[72%] w-[72%] fill-none stroke-current" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/></svg></span>;
}
