'use client';

import { Children, ClipboardEvent, DragEvent, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Image from 'next/image';
import { ExternalLink, Github, Link2, Youtube } from 'lucide-react';
import { getToken } from '@/lib/api';

function ProtectedImage({src,alt}:{src:string;alt:string}) {
  const [url,setUrl]=useState('');
  useEffect(()=>{
    let active=true;let objectUrl='';
    fetch(src,{headers:{Authorization:`Bearer ${getToken()||''}`}}).then(async response=>{
      if(!response.ok)throw new Error('Imagem indisponível.');
      objectUrl=URL.createObjectURL(await response.blob());
      if(active)setUrl(objectUrl);
    }).catch(()=>{if(active)setUrl('');});
    return ()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[src]);
  return url?<Image unoptimized src={url} alt={alt} width={640} height={320} className="my-2 h-auto max-h-80 max-w-full rounded object-contain"/>:null;
}

function linkInfo(href:string){
  try{
    const url=new URL(href,'http://localhost');
    const parts=url.pathname.split('/').filter(Boolean);
    if(parts[0]==='board'&&parts[1]&&(url.hostname==='localhost'||(typeof window!=='undefined'&&url.origin===window.location.origin)))return {icon:<Link2 size={13}/>,label:url.searchParams.has('card')?'Cartão Orbit':'Quadro Orbit',detail:parts[1].slice(0,8)};
    if(url.hostname==='github.com'&&parts.length>=2)return {icon:<Github size={13}/>,label:'GitHub',detail:parts.slice(0,4).join(' / ')};
    if(url.hostname==='youtube.com'||url.hostname==='www.youtube.com'||url.hostname==='youtu.be')return {icon:<Youtube size={13}/>,label:'YouTube',detail:url.searchParams.get('v')||parts[0]||'Vídeo'};
    if(url.hostname==='figma.com'||url.hostname==='www.figma.com')return {icon:<Link2 size={13}/>,label:'Figma',detail:parts.slice(0,3).join(' / ')};
  }catch{}
  return null;
}

export function RichText({text}:{text:string}) {
  return <div className="rich-text break-words text-sm">
    <Markdown remarkPlugins={[remarkGfm]} components={{
      p:({children})=><p>{Children.map(children,child=>typeof child==='string'?child.split(/(@[\w.-]+)/g).map((part,index)=>part.startsWith('@')?<strong key={index} className="rounded bg-[#dfe1f8] px-0.5 text-[#403294]">{part}</strong>:part):child)}</p>,
      a:({children,href})=>{const info=href?linkInfo(href):null;return <a href={href} target="_blank" rel="noopener noreferrer" className={info?'my-0.5 inline-flex max-w-full items-center gap-1 rounded border border-[#dfe1e6] bg-white px-1.5 py-0.5 text-xs font-semibold text-[#0c66e4] no-underline shadow-sm':'text-[#0c66e4] underline'} title={info?.detail} onClick={event=>event.stopPropagation()}>{info?info.icon:null}<span className="truncate">{info?`${info.label}: ${info.detail}`:children}</span>{info&&<ExternalLink size={11}/>}</a>},
      img:({src,alt})=>typeof src==='string'&&src?(src.startsWith('/api/card-attachments/')?<ProtectedImage src={src} alt={alt||''}/>:<Image unoptimized src={src} alt={alt||''} width={640} height={320} className="my-2 h-auto max-h-80 max-w-full rounded object-contain"/>):null,
      code:({children})=><code className="rounded bg-[#e9eaed] px-1 font-mono text-xs">{children}</code>,
      pre:({children})=><pre className="my-2 overflow-x-auto rounded bg-[#e9eaed] p-3 text-xs">{children}</pre>,
      blockquote:({children})=><blockquote className="my-2 border-l-4 border-[#8590a2] pl-3 text-[#626f86]">{children}</blockquote>,
      table:({children})=><div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-sm">{children}</table></div>,
      th:({children})=><th className="border border-[#dfe1e6] p-1 text-left">{children}</th>,
      td:({children})=><td className="border border-[#dfe1e6] p-1">{children}</td>,
    }}>{text}</Markdown>
  </div>;
}

export function MarkdownEditor({value,onChange,placeholder,maxLength=10000,onImageFiles}: {
  value:string;onChange:(value:string)=>void;placeholder?:string;maxLength?:number;onImageFiles?:(files:File[])=>Promise<string[]>;
}) {
  const input=useRef<HTMLTextAreaElement>(null);
  const [preview,setPreview]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [uploadError,setUploadError]=useState('');
  function insert(before:string,after='',fallback='texto') {
    const element=input.current;
    if(!element)return;
    const start=element.selectionStart,end=element.selectionEnd;
    const selection=value.slice(start,end)||fallback;
    const next=value.slice(0,start)+before+selection+after+value.slice(end);
    if(next.length>maxLength)return;
    onChange(next);
    requestAnimationFrame(()=>{element.focus();element.setSelectionRange(start+before.length,start+before.length+selection.length)});
  }
  async function addImages(files:File[]) {
    if(!onImageFiles||!files.length)return;
    setUploading(true);setUploadError('');
    try { const markdown=(await onImageFiles(files)).map((url,index)=>`![Imagem ${index+1}](${url})`).join('\n');const next=`${value}${value&&!value.endsWith('\n')?'\n\n':''}${markdown}\n`;if(next.length>maxLength)throw new Error('A descrição ficou maior que o limite permitido.');onChange(next); }
    catch(error){setUploadError(error instanceof Error?error.message:'Não foi possível anexar a imagem.');}
    finally{setUploading(false);}
  }
  function imagesFromClipboard(event:ClipboardEvent<HTMLTextAreaElement>){return Array.from(event.clipboardData.files).filter(file=>file.type.startsWith('image/'));}
  function imagesFromDrop(event:DragEvent<HTMLTextAreaElement>){return Array.from(event.dataTransfer.files).filter(file=>file.type.startsWith('image/'));}
  const button=(title:string,label:string,before:string,after='',fallback='texto')=><button type="button" title={title} onClick={()=>insert(before,after,fallback)} className="rounded px-2 py-1 text-xs font-semibold hover:bg-[#dfe1e6]">{label}</button>;
  return <div className="overflow-hidden rounded border border-[#8590a2] bg-white">
    <div className="flex flex-wrap items-center gap-0.5 border-b border-[#dfe1e6] bg-[#f1f2f4] p-1">
      {button('Cabeçalho','H','# ','','Título')}
      {button('Negrito','B','**','**')}
      {button('Itálico','I','*','*')}
      {button('Tachado','S','~~','~~')}
      {button('Código','</>','`','`','código')}
      {button('Lista','•','- ','','Item')}
      {button('Lista numerada','1.','1. ','','Item')}
      {button('Citação','❝','> ','','Citação')}
      {button('Link','🔗','[','](https://exemplo.com)','texto do link')}
      {button('Imagem','▧','![','](https://exemplo.com/imagem.png)','descrição da imagem')}
      <span className="flex-1"/>
      <button type="button" onClick={()=>setPreview(!preview)} className="rounded px-2 py-1 text-xs font-semibold text-[#0c66e4] hover:bg-[#dfe1e6]">{preview?'Editar':'Prévia'}</button>
    </div>
    {preview?<div className="min-h-32 p-3"><RichText text={value}/></div>:<textarea ref={input} value={value} onChange={event=>onChange(event.target.value)} rows={7} maxLength={maxLength} placeholder={placeholder} onPaste={event=>{const files=imagesFromClipboard(event);if(files.length){event.preventDefault();void addImages(files);}}} onDragOver={event=>{if(imagesFromDrop(event).length)event.preventDefault();}} onDrop={event=>{const files=imagesFromDrop(event);if(files.length){event.preventDefault();void addImages(files);}}} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='b'){event.preventDefault();insert('**','**')} if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='i'){event.preventDefault();insert('*','*')}}} className="w-full resize-y p-3 text-sm outline-none"/>}
    {uploading&&<p className="px-3 pb-2 text-xs text-[#626f86]">Enviando imagem…</p>}{uploadError&&<p role="alert" className="px-3 pb-2 text-xs text-[#ae2a19]">{uploadError}</p>}
    <div className="border-t border-[#dfe1e6] px-3 py-1 text-right text-[11px] text-[#626f86]">Markdown · {value.length}/{maxLength}</div>
  </div>;
}
