import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {GoogleMeetAttendanceAdapter,GOOGLE_MEET_READ_SCOPE} from './meet-attendance';

const recordName='conferenceRecords/record-123';
const makeAdapter=(token: (scopes:string[])=>Promise<string>)=>new GoogleMeetAttendanceAdapter({token:async(_owner:string,_connection:string,scopes:string[])=>token(scopes)} as never);
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});

test('Google Meet adapter fetches exact ended report and all participant session pages',async()=>{
  const previous=global.fetch,calls:string[]=[];
  global.fetch=async(input,init)=>{
    const url=String(input);calls.push(url);assert.equal(new Headers(init?.headers).get('authorization'),'Bearer meet-token');
    if(url.endsWith('/conferenceRecords/record-123'))return json({name:recordName,startTime:'2026-05-01T10:00:00Z',endTime:'2026-05-01T11:00:00Z'});
    if(url.includes('pageToken=next'))return json({participants:[{name:`${recordName}/participants/p-2`,email:'guest@example.test'}]});
    if(url.includes('/participants?'))return json({participants:[{name:`${recordName}/participants/p-1`,signedinUser:{email:'STUDENT@example.test'}}],nextPageToken:'next'});
    if(url.includes('/participants/p-1/participantSessions'))return json({participantSessions:[{startTime:'2026-05-01T10:05:00Z',endTime:'2026-05-01T10:35:00Z'}]});
    if(url.includes('/participants/p-2/participantSessions'))return json({participantSessions:[{startTime:'2026-05-01T10:20:00Z',endTime:'2026-05-01T10:50:00Z'}]});
    throw new Error(`Unexpected URL ${url}`);
  };
  try{
    const report=await makeAdapter(async scopes=>{assert.deepEqual(scopes,[GOOGLE_MEET_READ_SCOPE]);return 'meet-token'}).fetchReport('owner','connection',recordName);
    assert.deepEqual(report,{provider:'google_meet',conferenceRecordName:recordName,startTime:'2026-05-01T10:00:00.000Z',endTime:'2026-05-01T11:00:00.000Z',participants:[
      {providerParticipantId:'p-1',email:'student@example.test',joinedAt:'2026-05-01T10:05:00.000Z',leftAt:'2026-05-01T10:35:00.000Z'},
      {providerParticipantId:'p-2',email:'guest@example.test',joinedAt:'2026-05-01T10:20:00.000Z',leftAt:'2026-05-01T10:50:00.000Z'},
    ]});
    assert.equal(calls.length,5);
  }finally{global.fetch=previous}
});

test('Google Meet adapter fails closed before API access when the connection lacks the Meet read scope',async()=>{
  const previous=global.fetch;let called=false;global.fetch=async()=>{called=true;return json({})};
  try{
    await assert.rejects(()=>makeAdapter(async scopes=>{assert.deepEqual(scopes,[GOOGLE_MEET_READ_SCOPE]);throw new Error('missing scope')}).fetchReport('owner','connection',recordName),/missing scope/);
    assert.equal(called,false);
    await assert.rejects(()=>makeAdapter(async()=> 'token').fetchReport('owner','connection','https://evil.example/conferenceRecords/x'),/inválido/);
  }finally{global.fetch=previous}
});

test('Google Meet adapter rejects mismatched identity, incomplete pagination, and invalid session times',async()=>{
  const previous=global.fetch;
  try{
    global.fetch=async input=>String(input).endsWith('/conferenceRecords/record-123')?json({name:'conferenceRecords/other',startTime:'2026-05-01T10:00:00Z',endTime:'2026-05-01T11:00:00Z'}):json({});
    await assert.rejects(()=>makeAdapter(async()=> 'token').fetchReport('owner','connection',recordName),/outra conferência/);
    global.fetch=async input=>{
      const url=String(input);if(url.endsWith('/conferenceRecords/record-123'))return json({name:recordName,startTime:'2026-05-01T10:00:00Z',endTime:'2026-05-01T11:00:00Z'});
      if(url.includes('/participants?'))return json({participants:[{name:`${recordName}/participants/p-1`}]});
      return json({participantSessions:[{startTime:'2026-05-01T10:01:00Z'}]});
    };
    await assert.rejects(()=>makeAdapter(async()=> 'token').fetchReport('owner','connection',recordName),/fim da sessão/);
  }finally{global.fetch=previous}
});

test('Google Meet adapter discovers one exact meeting space and scheduled session',async()=>{
  const previous=global.fetch,code='abc-defg-hij',start='2026-05-01T10:00:00Z',end='2026-05-01T11:00:00Z',name='conferenceRecords/match-1';let listingUrl='';
  global.fetch=async input=>{
    const url=String(input);
    if(url.includes('/conferenceRecords?')){listingUrl=url;return json({conferenceRecords:[{name,space:{meetingCode:code},startTime:start,endTime:end}]})}
    if(url.endsWith('/conferenceRecords/match-1'))return json({name,space:{meetingCode:code},startTime:start,endTime:end});
    if(url.endsWith('/participants?pageSize=250'))return json({participants:[]});
    throw new Error(`Unexpected URL ${url}`);
  };
  try{
    const report=await makeAdapter(async scopes=>{assert.deepEqual(scopes,[GOOGLE_MEET_READ_SCOPE]);return 'meet-token'}).fetchReportForSpace('owner','connection',code,start,end);
    assert.equal(report.conferenceRecordName,name);assert.equal(report.participants.length,0);
    const filter=new URL(listingUrl).searchParams.get('filter');
    assert.equal(filter,'space.meeting_code = "abc-defg-hij" AND start_time >= "2026-05-01T09:45:00.000Z" AND start_time <= "2026-05-01T10:15:00.000Z"');
  }finally{global.fetch=previous}
});

test('Google Meet space discovery rejects no exact match, ambiguity, and invalid-code inputs',async()=>{
  const previous=global.fetch,code='abc-defg-hij',start='2026-05-01T10:00:00Z',end='2026-05-01T11:00:00Z';
  const record=(name:string,meetingCode:string,startTime:string,endTime:string)=>({name,space:{meetingCode},startTime,endTime});
  try{
    global.fetch=async()=>json({conferenceRecords:[record('conferenceRecords/wrong-code','xyz-uvwx-rst',start,end)]});
    await assert.rejects(()=>makeAdapter(async()=> 'token').fetchReportForSpace('owner','connection',code,start,end),/Não foi encontrada/);
    global.fetch=async()=>json({conferenceRecords:[record('conferenceRecords/one',code,start,end),record('conferenceRecords/two',code,start,end)]});
    await assert.rejects(()=>makeAdapter(async()=> 'token').fetchReportForSpace('owner','connection',code,start,end),/Mais de uma/);
    await assert.rejects(()=>makeAdapter(async()=> 'token').fetchReportForSpace('owner','connection','https://meet.google.com/abc-defg-hij',start,end),/inválido/);
  }finally{global.fetch=previous}
});
