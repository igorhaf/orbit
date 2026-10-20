import {HttpException,Injectable,Logger} from '@nestjs/common';
import {IncomingHttpHeaders} from 'node:http';
import {X509Certificate,createHash,verify as verifySignature,type KeyObject} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rootCertificates} from 'node:tls';
import {Configuration,Envelope} from './model';
const execute=promisify(execFile);
export function verifyAlexaRequestSignature(raw:string,signature:string,publicKey:KeyObject):boolean{
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(signature))return false;
 const bytes=Buffer.from(signature,'base64');
 if(!bytes.length||bytes.toString('base64').replace(/=+$/,'')!==signature.replace(/=+$/,''))return false;
 return verifySignature('RSA-SHA256',Buffer.from(raw,'utf8'),publicKey,bytes);
}
export async function verifyNativeChain(pem:string){
 const blocks=pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);if(!blocks?.length||pem.length>100000)throw new Error('Certificado inválido.');
 const leaf=new X509Certificate(blocks[0]);if(!leaf.subjectAltName?.split(/,\s*/).includes('DNS:echo-api.amazon.com')||Date.parse(leaf.validFrom)>Date.now()||Date.parse(leaf.validTo)<Date.now())throw new Error('Certificado inválido.');
 const directory=await mkdtemp(join(tmpdir(),'orbit-alexa-cert-'));
 try{await Promise.all([writeFile(join(directory,'roots.pem'),rootCertificates.join('\n'),{mode:0o600}),writeFile(join(directory,'leaf.pem'),blocks[0],{mode:0o600}),writeFile(join(directory,'chain.pem'),blocks.slice(1).join('\n'),{mode:0o600})]);await execute('openssl',['verify','-CAfile',join(directory,'roots.pem'),...blocks.length>1?['-untrusted',join(directory,'chain.pem')]:[],'-verify_hostname','echo-api.amazon.com',join(directory,'leaf.pem')],{timeout:3000,maxBuffer:8000});}finally{await rm(directory,{recursive:true,force:true})}
}
class AlexaVerificationError extends HttpException{
 constructor(readonly reason:string){super('Requisição Alexa inválida.',400)}
}
export function verifyIdentity(envelope:Envelope,config:Configuration){
 const reject=(reason:string):never=>{throw new AlexaVerificationError(reason)};
 const ids=[envelope.context?.System?.application?.applicationId,envelope.session?.application?.applicationId].filter(Boolean);
 const users=[envelope.context?.System?.user?.userId,envelope.session?.user?.userId].filter(Boolean);
 if(!config.skillId||!ids.length||ids.some(id=>id!==config.skillId))reject('skill_id');
 if(!users.length||users.some(id=>!config.allowedUserIds.includes(id!))||users.some(id=>id!==users[0]))reject('user_id');
 const time=Date.parse(envelope.request?.timestamp);
 if(!Number.isFinite(time)||Math.abs(Date.now()-time)>150000)reject('timestamp');
 if(typeof envelope.request?.requestId!=='string'||!envelope.request.requestId||envelope.request.requestId.length>300)reject('request_id');
}
@Injectable()
export class AlexaSecurity{
 private logger=new Logger('AlexaOrbitSecurity');
 private certificates=new Map<string,{certificate:X509Certificate;expiresAt:number}>();private trusted=new Map<string,number>();
 private async certificate(url:string){
  const cached=this.certificates.get(url);if(cached&&cached.expiresAt>Date.now())return cached.certificate;
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(4000)});if(!response.ok)throw new Error('Certificado indisponível.');
  const contentLength=Number(response.headers.get('content-length')||0);if(contentLength>100000)throw new Error('Certificado inválido.');
  const pem=await response.text();if(pem.length>100000)throw new Error('Certificado inválido.');
  const leaf=pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0];if(!leaf)throw new Error('Certificado inválido.');
  const certificate=new X509Certificate(leaf),digest=createHash('sha256').update(pem).digest('hex');
  if((this.trusted.get(digest)||0)<Date.now()){await verifyNativeChain(pem);this.trusted.set(digest,Math.min(Date.now()+3600000,Date.parse(certificate.validTo)))}
  this.certificates.set(url,{certificate,expiresAt:Math.min(Date.now()+3600000,Date.parse(certificate.validTo))});return certificate;
 }
 async verify(body:Buffer|undefined,headers:IncomingHttpHeaders,config:Configuration):Promise<Envelope>{
  let stage='body';
  try{if(!body||body.length>64000)throw new Error('Corpo inválido.');const raw=body.toString('utf8'),envelope=JSON.parse(raw) as Envelope;stage='identity';verifyIdentity(envelope,config);stage='signature_headers';
    const certUrl=headers.signaturecertchainurl,signature=headers['signature-256'];if(typeof certUrl!=='string'||typeof signature!=='string')throw new Error('Assinatura ausente.');const url=new URL(certUrl);if(url.protocol!=='https:'||url.hostname!=='s3.amazonaws.com'||url.port&&url.port!=='443'||url.username||url.password||url.search||url.hash||!/^\/echo\.api\/[A-Za-z0-9._/-]+$/.test(url.pathname)||url.pathname.includes('//')||url.pathname.split('/').some(part=>part==='.'||part==='..'))throw new Error('URL de certificado inválida.');
    stage='certificate_chain';if(this.trusted.size>20){this.trusted.clear();this.certificates.clear()}const certificate=await this.certificate(url.toString());
    stage='signature';if(!verifyAlexaRequestSignature(raw,signature,certificate.publicKey))throw new Error('Assinatura inválida.');return envelope;
  }catch(error){this.logger.warn(JSON.stringify({event:'alexa_request_rejected',stage,reason:error instanceof AlexaVerificationError?error.reason:stage}));throw new HttpException('Requisição Alexa inválida.',400)}
 }
}
