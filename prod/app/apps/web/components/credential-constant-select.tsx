'use client';
import {useEffect,useState} from 'react';
import {api} from '@/lib/api';
type Constant={reference:string;label:string;name:string;notebook:string};
export function CredentialConstantSelect({value,onChange,label='Usar credencial cadastrada'}:{value:string;onChange:(value:string)=>void;label?:string}){
  const [options,setOptions]=useState<Constant[]>([]),[error,setError]=useState('');
  useEffect(()=>{let active=true;void api<Constant[]>('/account/credential-constants').then(items=>{if(active)setOptions(items)}).catch(()=>{if(active)setError('Não foi possível carregar as constantes de credenciais.')});return()=>{active=false}},[]);
  return <div className="mt-2 min-w-0"><select aria-label={label} className="min-h-11 w-full min-w-0 rounded border border-[#c1c7d0] bg-white px-2 py-2 text-xs font-normal" value={value.startsWith('orbit-vault://')?value:''} onChange={event=>onChange(event.target.value)}><option value="">Valor manual · escolher constante</option>{value.startsWith('orbit-vault://')&&!options.some(option=>option.reference===value)&&<option value={value}>Constante configurada</option>}{options.map(option=><option key={option.reference} value={option.reference}>{option.label} · {option.notebook}{option.name?` · ${option.name}`:''}</option>)}</select>{error&&<p role="alert" className="mt-1 text-xs text-[#ae2a19]">{error}</p>}</div>;
}
