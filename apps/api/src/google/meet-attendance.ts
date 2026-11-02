import {HttpException,Inject,Injectable} from '@nestjs/common';
import {GoogleCredentials} from './credentials';

export const GOOGLE_MEET_READ_SCOPE='https://www.googleapis.com/auth/meetings.space.readonly';

export type GoogleMeetAttendanceInterval={providerParticipantId:string;email:string|null;joinedAt:string;leftAt:string};
export type GoogleMeetAttendanceReport={
  provider:'google_meet';
  conferenceRecordName:string;
  startTime:string;
  endTime:string;
  participants:GoogleMeetAttendanceInterval[];
};

type ConferenceRecord={name?:unknown;startTime?:unknown;endTime?:unknown;space?:{meetingCode?:unknown}};
type Participant={name?:unknown;email?:unknown;signedinUser?:{email?:unknown};};
type ParticipantSession={startTime?:unknown;endTime?:unknown};
type Page<T>={nextPageToken?:unknown;participants?:T[];participantSessions?:T[]};
const MATCH_TOLERANCE_MS=15*60*1000;

const recordId=(name:string)=>{
  const match=/^conferenceRecords\/([A-Za-z0-9_-]+)$/.exec(name);
  if(!match)throw new HttpException('Identificador de conferência Google Meet inválido.',400);
  return match[1];
};
const timestamp=(value:unknown,label:string)=>{
  if(typeof value!=='string'||!value||!Number.isFinite(Date.parse(value)))throw new HttpException(`Relatório Google Meet sem ${label} válido.`,502);
  return new Date(value).toISOString();
};
const opaqueId=(name:unknown,prefix:string)=>{
  if(typeof name!=='string'||!name.startsWith(prefix))throw new HttpException('A API Google Meet retornou uma identidade de participante inválida.',502);
  const id=name.slice(prefix.length);
  if(!id||id.split('/').some(part=>!part||part==='.'||part==='..'))throw new HttpException('A API Google Meet retornou uma identidade de participante inválida.',502);
  return id;
};
const path=(value:string)=>value.split('/').map(encodeURIComponent).join('/');
const validEmail=(value:unknown):string|null=>typeof value==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)?value.trim().toLowerCase():null;

@Injectable()
export class GoogleMeetAttendanceAdapter {
  constructor(@Inject(GoogleCredentials) private readonly google:GoogleCredentials){}

  async fetchReportForSpace(ownerId:string,connectionId:string,meetingCode:string,expectedStart:string,expectedEnd:string):Promise<GoogleMeetAttendanceReport>{
    const code=meetingCode.trim().toLowerCase();
    if(!/^[a-z0-9]{3}-[a-z0-9]{3,4}-[a-z0-9]{3}$/.test(code))throw new HttpException('Código de reunião Google Meet inválido.',400);
    const expectedStartMs=Date.parse(expectedStart),expectedEndMs=Date.parse(expectedEnd);
    if(!Number.isFinite(expectedStartMs)||!Number.isFinite(expectedEndMs)||expectedEndMs<=expectedStartMs)throw new HttpException('Período esperado da sessão inválido.',400);
    const token=await this.google.token(ownerId,connectionId,[GOOGLE_MEET_READ_SCOPE]);
    const startFrom=new Date(expectedStartMs-MATCH_TOLERANCE_MS).toISOString(),startTo=new Date(expectedStartMs+MATCH_TOLERANCE_MS).toISOString();
    const filter=`space.meeting_code = "${code}" AND start_time >= "${startFrom}" AND start_time <= "${startTo}"`;
    const records=await this.listAllRecords(token,filter);
    const matching=records.filter(record=>{
      if(typeof record.name!=='string'||record.space?.meetingCode?.toString().toLowerCase()!==code||typeof record.endTime!=='string')return false;
      const start=Date.parse(String(record.startTime)),end=Date.parse(record.endTime);
      return Number.isFinite(start)&&Number.isFinite(end)&&end>start&&Math.abs(start-expectedStartMs)<=MATCH_TOLERANCE_MS&&Math.abs(end-expectedEndMs)<=MATCH_TOLERANCE_MS;
    });
    if(matching.length!==1)throw new HttpException(matching.length===0?'Não foi encontrada uma conferência Google Meet encerrada para esta sessão.':'Mais de uma conferência Google Meet corresponde a esta sessão; a sincronização foi interrompida.',409);
    return this.fetchReport(ownerId,connectionId,String(matching[0].name));
  }

  async fetchReport(ownerId:string,connectionId:string,conferenceRecordName:string):Promise<GoogleMeetAttendanceReport>{
    const id=recordId(conferenceRecordName);
    const token=await this.google.token(ownerId,connectionId,[GOOGLE_MEET_READ_SCOPE]);
    const record=await this.get<ConferenceRecord>(token,`conferenceRecords/${encodeURIComponent(id)}`);
    if(record.name!==conferenceRecordName)throw new HttpException('A API Google Meet retornou outra conferência.',502);
    const startTime=timestamp(record.startTime,'horário inicial'),endTime=timestamp(record.endTime,'horário final');
    if(Date.parse(endTime)<=Date.parse(startTime))throw new HttpException('O relatório Google Meet não representa uma conferência encerrada válida.',502);

    const participants:GoogleMeetAttendanceInterval[]=[];
    const participantNames=await this.listAll<Participant>(token,`conferenceRecords/${encodeURIComponent(id)}/participants`,'participants');
    for(const raw of participantNames){
      const participant=raw as Participant;
      const participantId=opaqueId(participant.name,`${conferenceRecordName}/participants/`);
      const participantResource=`${conferenceRecordName}/participants/${participantId}`;
      const email=validEmail(participant.email)??validEmail(participant.signedinUser?.email);
      const sessions=await this.listAll<ParticipantSession>(token,`${path(participantResource)}/participantSessions`,'participantSessions');
      for(const rawSession of sessions){
        const session=rawSession as ParticipantSession;
        const joinedAt=timestamp(session.startTime,'início da sessão de participante'),leftAt=timestamp(session.endTime,'fim da sessão de participante');
        if(Date.parse(leftAt)<=Date.parse(joinedAt)||Date.parse(joinedAt)<Date.parse(startTime)||Date.parse(leftAt)>Date.parse(endTime))throw new HttpException('A API Google Meet retornou uma sessão fora do período da conferência.',502);
        participants.push({providerParticipantId:participantId,email,joinedAt,leftAt});
      }
    }
    return {provider:'google_meet',conferenceRecordName,startTime,endTime,participants};
  }

  private async get<T>(token:string,resource:string):Promise<T>{
    const response=await fetch(`https://meet.googleapis.com/v2/${resource}`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new HttpException(`A API Google Meet não retornou o relatório solicitado (HTTP ${response.status}).`,502);
    try{return await response.json() as T}catch{throw new HttpException('A API Google Meet retornou uma resposta inválida.',502)}
  }

  private async listAll<T>(token:string,resource:string,field:'participants'|'participantSessions'):Promise<T[]>{
    const items:T[]=[],seenTokens=new Set<string>();let pageToken:string|undefined;
    for(let page=0;page<1000;page++){
      const query=new URLSearchParams({pageSize:'250'});if(pageToken)query.set('pageToken',pageToken);
      const result=await this.get<Page<T>>(token,`${resource}?${query}`),rows=result[field];
      if(!Array.isArray(rows))throw new HttpException('A API Google Meet retornou uma página inválida.',502);
      items.push(...rows as T[]);
      const next=result.nextPageToken;
      if(next===undefined||next===null||next==='')return items;
      if(typeof next!=='string'||seenTokens.has(next))throw new HttpException('A API Google Meet retornou paginação inválida.',502);
      seenTokens.add(next);pageToken=next;
    }
    throw new HttpException('O relatório Google Meet excedeu o limite de páginas permitido.',502);
  }

  private async listAllRecords(token:string,filter:string):Promise<ConferenceRecord[]>{
    const records:ConferenceRecord[]=[],seenTokens=new Set<string>();let pageToken:string|undefined;
    for(let page=0;page<1000;page++){
      const query=new URLSearchParams({pageSize:'100',filter});if(pageToken)query.set('pageToken',pageToken);
      const result=await this.get<{conferenceRecords?:unknown;nextPageToken?:unknown}>(token,`conferenceRecords?${query}`);
      if(!Array.isArray(result.conferenceRecords))throw new HttpException('A API Google Meet retornou uma lista de conferências inválida.',502);
      records.push(...result.conferenceRecords as ConferenceRecord[]);
      const next=result.nextPageToken;
      if(next===undefined||next===null||next==='')return records;
      if(typeof next!=='string'||seenTokens.has(next))throw new HttpException('A API Google Meet retornou paginação inválida.',502);
      seenTokens.add(next);pageToken=next;
    }
    throw new HttpException('A busca Google Meet excedeu o limite de páginas permitido.',502);
  }

}
