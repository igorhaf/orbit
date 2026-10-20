import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';

type KeyCandidate={id:string;current:Buffer;legacy:Buffer};
const unavailable='Conteúdo criptografado inválido ou chave indisponível; confira a configuração de chaves.';
const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest();
const candidates=(secrets:string[],purpose:string):KeyCandidate[]=>[...new Set(secrets.filter(Boolean))].map(secret=>{
  const current=sha256(`${purpose}\0${secret}`);
  return {id:sha256(current).toString('hex').slice(0,24),current,legacy:sha256(secret)};
});

export function sealJson(value:unknown,secret:string,purpose:string):string{
  if(!secret)throw new Error('Chave de criptografia não configurada.');
  const key=candidates([secret],purpose)[0];const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key.current,iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return ['v2',key.id,iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}

export function openJson<T>(value:string,secrets:string[],purpose:string):T{
  const keys=candidates(secrets,purpose);if(!keys.length)throw new Error(unavailable);
  try{
    const parts=value.split('.');let ivText:string;let tagText:string;let dataText:string;let selected:KeyCandidate|undefined;
    if(parts.length===5&&parts[0]==='v2'){
      selected=keys.find(candidate=>candidate.id===parts[1]);if(!selected)throw new Error(unavailable);
      [, ,ivText,tagText,dataText]=parts;
    }else if(parts.length===4&&parts[0]==='v1'){
      [,ivText,tagText,dataText]=parts;
    }else if(parts.length===3){
      [ivText,tagText,dataText]=parts;
    }else throw new Error(unavailable);
    const iv=Buffer.from(ivText,'base64url');const tag=Buffer.from(tagText,'base64url');const encrypted=Buffer.from(dataText,'base64url');
    if(iv.length!==12||tag.length!==16||!encrypted.length)throw new Error(unavailable);
    const legacy=parts.length!==5;
    for(const candidate of selected?[selected]:keys){
      const decipher=createDecipheriv('aes-256-gcm',legacy?candidate.legacy:candidate.current,iv);decipher.setAuthTag(tag);
      try{return JSON.parse(Buffer.concat([decipher.update(encrypted),decipher.final()]).toString('utf8')) as T}catch{/* Try the next configured legacy key without exposing crypto errors. */}
    }
  }catch{/* Return one generic error for malformed data, missing keys and authentication failures. */}
  throw new Error(unavailable);
}

export function configuredKeys(...values:Array<string|undefined>):string[]{return [...new Set(values.filter((value):value is string=>Boolean(value?.trim())))];}
