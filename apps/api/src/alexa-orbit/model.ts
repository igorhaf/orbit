import {HttpException} from '@nestjs/common';
export const PLUGIN_ID='alexa-orbit';
export const ENDPOINT='/integrations/alexa/orbit';
export type Destination={boardId:string;columnId:string};
export type Configuration={aiEffort?:'low'|'medium'|'high';skillId:string;allowedUserIds:string[];publicEndpoint:string;timeZone:string;taskDestination:Destination|null;purchaseDestination:Destination|null;appointmentDestination:{calendarId:string;boardId?:string;columnId?:string}|null;developmentSimulation:boolean};
export const emptyConfiguration:Configuration={aiEffort:'low',skillId:'',allowedUserIds:[],publicEndpoint:'',timeZone:'',taskDestination:null,purchaseDestination:null,appointmentDestination:null,developmentSimulation:false};
export type Envelope={version?:string;context?:{System?:{application?:{applicationId?:string};user?:{userId?:string}}};session?:{attributes?:{clarificationJobId?:string;conversationJobId?:string;dialogPhase?:'waiting'|'clarification'|'more'};application?:{applicationId?:string};user?:{userId?:string}};request:{type:string;requestId:string;timestamp:string;locale?:string;intent?:{name:string;slots?:Record<string,{name?:string;value?:string}>}}};
export type VoiceResponse={version:'1.0';sessionAttributes?:{clarificationJobId?:string;conversationJobId?:string;dialogPhase?:'waiting'|'clarification'|'more'};response:{outputSpeech?:{type:'PlainText';text:string};reprompt?:{outputSpeech:{type:'PlainText';text:string}};shouldEndSession:boolean;directives?:Array<{type:'Dialog.ElicitSlot';slotToElicit:string;updatedIntent?:{name:string;confirmationStatus:'NONE';slots:Record<string,{name:string;confirmationStatus:'NONE'}>}}>}};
export function response(text?:string,end=true,slot?:string):VoiceResponse{
 const reply:VoiceResponse={version:'1.0',sessionAttributes:{},response:{shouldEndSession:end}};
 if(text)reply.response.outputSpeech={type:'PlainText',text};
 if(!end&&text)reply.response.reprompt={outputSpeech:{type:'PlainText',text}};
 if(slot)reply.response.directives=[{type:'Dialog.ElicitSlot',slotToElicit:slot}];
 return reply;
}
const invalid=(message:string):never=>{throw new HttpException(message,400)};
export function uid(value:unknown){if(typeof value!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value))return invalid('Destino inválido.');return value}
export function configuration(input:unknown):Configuration{
 if(!input||typeof input!=='object'||Array.isArray(input))return invalid('Configuração inválida.');const value=input as Record<string,unknown>;
 if(Object.keys(value).some(key=>!Object.hasOwn(emptyConfiguration,key)))return invalid('Campo de configuração desconhecido.');
 const result={...emptyConfiguration,...value} as Configuration;
 for(const key of ['skillId','publicEndpoint','timeZone'] as const)if(typeof result[key]!=='string'||result[key].length>2000)return invalid('Configuração inválida.');
 if(result.skillId&&!/^amzn1\.ask\.skill\.[a-zA-Z0-9-]+$/.test(result.skillId)&&!result.skillId.startsWith('orbit-vault://'))return invalid('Skill ID inválido.');
 if(!Array.isArray(result.allowedUserIds)||result.allowedUserIds.length>50||result.allowedUserIds.some(id=>typeof id!=='string'||!/^amzn1\.(ask|account)\.[\w.-]+$/.test(id)))return invalid('IDs de usuários Alexa inválidos.');
 if(result.publicEndpoint){let url:URL;try{url=new URL(result.publicEndpoint)}catch{return invalid('Endpoint público inválido.')}if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search||![ENDPOINT,`/api${ENDPOINT}`].includes(url.pathname))return invalid(`Use um endpoint HTTPS com o caminho ${ENDPOINT}.`)}
 if(result.timeZone)try{new Intl.DateTimeFormat('pt-BR',{timeZone:result.timeZone}).format()}catch{return invalid('Fuso horário inválido.')}
 if(!['low','medium','high'].includes(String(result.aiEffort)))return invalid('Esforço de IA por voz inválido.');
 if(typeof result.developmentSimulation!=='boolean')return invalid('Simulador inválido.');
 for(const key of ['taskDestination','purchaseDestination'] as const){const target=result[key];if(target!==null){if(typeof target!=='object'||Object.keys(target).some(key=>!['boardId','columnId'].includes(key)))return invalid('Destino inválido.');uid(target.boardId);uid(target.columnId)}}
 if(result.appointmentDestination!==null){const target=result.appointmentDestination;if(typeof target!=='object'||Object.keys(target).some(key=>!['calendarId','boardId','columnId'].includes(key)))return invalid('Calendário inválido.');uid(target.calendarId);if(target.boardId)uid(target.boardId);if(target.columnId)uid(target.columnId)}
 return result;
}
export function slot(envelope:Envelope,key:string){const value=envelope.request.intent?.slots?.[key]?.value;return typeof value==='string'?value.trim():''}
/** Alexa supplies normalized date/time slots; no free-language date parsing. */
export function appointmentInstant(date:string,time:string,timeZone:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}(?::\d{2})?$/.test(time))throw new Error('Informe um dia e um horário exatos.');
 if(!timeZone)throw new Error('Configure o fuso horário dos compromissos.');
 const [year,month,day]=date.split('-').map(Number),[hour,minute,second=0]=time.split(':').map(Number);if(hour>23||minute>59||second>59||year<2000||year>2100)throw new Error('Data ou horário inválido.');
 const wall=Date.UTC(year,month-1,day,hour,minute,second),formatter=new Intl.DateTimeFormat('sv-SE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const parts=(instant:number)=>Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part=>[part.type,part.value]));const matches=new Set<number>();
 for(const delta of [-86400000,0,86400000]){const probe=wall+delta,p=parts(probe),offset=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-probe,candidate=wall-offset,c=parts(candidate);if(+c.year===year&&+c.month===month&&+c.day===day&&+c.hour===hour&&+c.minute===minute&&+c.second===second)matches.add(candidate)}
 if(matches.size!==1)throw new Error('Esse horário é inexistente ou ambíguo no fuso configurado. Escolha outro horário.');return new Date([...matches][0]).toISOString();
}

export function listen(text:string,clarificationJobId?:string,conversationJobId?:string,dialogPhase?:'waiting'|'clarification'|'more'):VoiceResponse{
 const reply=response(text,false,'utterance');
 reply.response.directives![0].updatedIntent={name:'OrbitMessageIntent',confirmationStatus:'NONE',slots:{utterance:{name:'utterance',confirmationStatus:'NONE'}}};
 reply.sessionAttributes={...clarificationJobId?{clarificationJobId}:{},...conversationJobId?{conversationJobId}:{},...dialogPhase?{dialogPhase}:{}};
 return reply;
}
