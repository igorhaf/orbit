import {HttpException,Injectable,Logger} from '@nestjs/common';
import {SkillRequestSignatureVerifier,TimestampVerifier} from 'ask-sdk-express-adapter';
import {IncomingHttpHeaders} from 'node:http';
import {X509Certificate,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rootCertificates} from 'node:tls';
import {Configuration,Envelope} from './model';
class OfficialVerifier extends SkillRequestSignatureVerifier{certificate(url:string){return this.certCache.get(url)}clear(){this.certCache.clear()}}
const execute=promisify(execFile);
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
 private signature=new OfficialVerifier();private timestamp=new TimestampVerifier();private trusted=new Map<string,number>();
 async verify(body:Buffer|undefined,headers:IncomingHttpHeaders,config:Configuration):Promise<Envelope>{
  let stage='body';
  try{if(!body||body.length>64000)throw new Error('Corpo inválido.');const raw=body.toString('utf8'),envelope=JSON.parse(raw) as Envelope;stage='identity';verifyIdentity(envelope,config);stage='timestamp';await this.timestamp.verify(raw);stage='signature_headers';
    const certUrl=headers.signaturecertchainurl,signature=headers['signature-256'];if(typeof certUrl!=='string'||typeof signature!=='string')throw new Error('Assinatura ausente.');const url=new URL(certUrl);if(url.protocol!=='https:'||url.hostname!=='s3.amazonaws.com'||url.port&&url.port!=='443'||url.username||url.password||url.search||url.hash||!url.pathname.startsWith('/echo.api/'))throw new Error('URL de certificado inválida.');
    stage='signature';
    if(this.trusted.size>20){this.trusted.clear();this.signature.clear()}
    let timer:NodeJS.Timeout|undefined;try{await Promise.race([this.signature.verify(raw,headers),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Verificação indisponível.')),4000)})])}finally{if(timer)clearTimeout(timer)}
    stage='certificate_chain';
    const pem=this.signature.certificate(certUrl);if(!pem)throw new Error('Certificado indisponível.');const digest=createHash('sha256').update(pem).digest('hex');if((this.trusted.get(digest)||0)<Date.now()){await verifyNativeChain(pem);this.trusted.set(digest,Math.min(Date.now()+3600000,Date.parse(new X509Certificate(pem).validTo)))}return envelope;
  }catch(error){this.logger.warn(JSON.stringify({event:'alexa_request_rejected',stage,reason:error instanceof AlexaVerificationError?error.reason:stage}));throw new HttpException('Requisição Alexa inválida.',400)}
 }
}
