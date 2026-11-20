import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { SecretVault } from "../secrets";
import { PluginRegistry } from "../execution/registries";
import { GoogleCalendarPlugin, googleCalendarPluginDefinition } from "./google-calendar.plugin";
import { MicrosoftGraphClient, MicrosoftGraphError } from "./microsoft-graph";
import { MicrosoftGraphSubscriptionManager } from "./microsoft-subscriptions";
import { graphDateTime, graphLocalToDate, microsoftTimeZone, orbitTimeZone } from "./microsoft-timezones";
import { OutlookCalendarPlugin, outlookCalendarPluginDefinition } from "./outlook-calendar.plugin";
import { MicrosoftTeamsPlugin, microsoftTeamsPluginDefinition } from "./microsoft-teams.plugin";
import { CalendarItem } from "./types";

const connection = {
  id: "00000000-0000-4000-8000-000000000010",
  owner_id: "00000000-0000-4000-8000-000000000001",
  plugin_id: "microsoft",
  external_account_id: "tenant:user",
  display_name: "Microsoft",
  credentials_encrypted: "sealed",
  enabled: true,
  status: "connected",
  capabilities: { outlookCalendar: true, teamsOnlineMeetings: true },
  metadata: { email: "owner@example.com", accountType: "work_or_school" },
};

test("Microsoft OAuth uses state, PKCE, offline access and incremental Teams consent", async () => {
  const previous = { key:process.env.ORBIT_SECRET_KEY,id:process.env.MICROSOFT_CLIENT_ID,secret:process.env.MICROSOFT_CLIENT_SECRET };
  process.env.ORBIT_SECRET_KEY="microsoft-test-secret-at-least-thirty-two-characters";
  process.env.MICROSOFT_CLIENT_ID="client";process.env.MICROSOFT_CLIENT_SECRET="secret";
  const calls:Array<{sql:string;params:unknown[]}>=[],db={query:async(sql:string,params:unknown[]=[])=>{calls.push({sql,params});return []}};
  try {
    const graph=new MicrosoftGraphClient(db as never,new SecretVault()),calendar=await graph.oauthUrl(connection.owner_id,"calendar"),teams=await graph.oauthUrl(connection.owner_id,"teams"),mail=await graph.oauthUrl(connection.owner_id,"mail"),calendarUrl=new URL(calendar.url),teamsUrl=new URL(teams.url),mailUrl=new URL(mail.url);
    assert.ok(calendarUrl.searchParams.get("scope")?.includes("offline_access"));
    assert.ok(calendarUrl.searchParams.get("scope")?.includes("Calendars.ReadWrite.Shared"));
    assert.ok(!calendarUrl.searchParams.get("scope")?.includes("OnlineMeetings.ReadWrite"));
    assert.ok(teamsUrl.searchParams.get("scope")?.includes("OnlineMeetings.ReadWrite"));
    assert.ok(mailUrl.searchParams.get("scope")?.includes("Mail.ReadWrite"));
    assert.ok(mailUrl.searchParams.get("scope")?.includes("Mail.Send"));
    assert.equal(calendarUrl.searchParams.get("code_challenge_method"),"S256");
    const insert=calls.find(call=>call.sql.includes("INSERT INTO oauth_states"))!;
    assert.equal(String(insert.params[0]).length,64);
    assert.notEqual(insert.params[0],calendarUrl.searchParams.get("state"));
    assert.ok(!String(insert.params[4]).includes("verifier"));
  } finally { for(const [key,value] of Object.entries(previous)){const env=key==='key'?'ORBIT_SECRET_KEY':key==='id'?'MICROSOFT_CLIENT_ID':'MICROSOFT_CLIENT_SECRET';if(value===undefined)delete process.env[env];else process.env[env]=value;} }
});

test("Microsoft token refresh remains encrypted and honors Graph retry headers", async () => {
  const previous={key:process.env.ORBIT_SECRET_KEY,id:process.env.MICROSOFT_CLIENT_ID,secret:process.env.MICROSOFT_CLIENT_SECRET},originalFetch=global.fetch;
  process.env.ORBIT_SECRET_KEY="microsoft-refresh-secret-at-least-thirty-two";process.env.MICROSOFT_CLIENT_ID="client";process.env.MICROSOFT_CLIENT_SECRET="secret";
  const vault=new SecretVault(),writes:unknown[][]=[];let requests=0;
  global.fetch=async(url)=>{requests++;if(String(url).includes("oauth2"))return new Response(JSON.stringify({access_token:"new",refresh_token:"rotated",expires_in:3600,scope:"Calendars.ReadWrite"}),{status:200,headers:{"content-type":"application/json"}});return new Response(JSON.stringify({value:[]}),{status:200,headers:{"content-type":"application/json"}})};
  try {
    const db={query:async(_sql:string,params:unknown[]=[])=>{writes.push(params);return []}},graph=new MicrosoftGraphClient(db as never,vault),current={...connection,credentials_encrypted:vault.seal({access_token:"old",refresh_token:"refresh",expires_at:0,scope:"Calendars.ReadWrite",token_type:"Bearer"})};
    assert.equal(await graph.accessToken(current),"new");
    assert.ok(!String(writes[0][1]).includes("rotated"));
    assert.equal(vault.open<{refresh_token:string}>(String(writes[0][1])).refresh_token,"rotated");
    await graph.request(current,"me/calendars");assert.equal(requests,2);
  } finally {global.fetch=originalFetch;for(const [key,value] of Object.entries(previous)){const env=key==='key'?'ORBIT_SECRET_KEY':key==='id'?'MICROSOFT_CLIENT_ID':'MICROSOFT_CLIENT_SECRET';if(value===undefined)delete process.env[env];else process.env[env]=value;}}
});

test("shared Microsoft connection isolates capability tokens without duplicating OAuth models", async () => {
  const previous=process.env.ORBIT_SECRET_KEY;process.env.ORBIT_SECRET_KEY="capability-token-secret-at-least-thirty-two";
  try {
    const vault=new SecretVault(),graph=new MicrosoftGraphClient({} as never,vault),future=Date.now()+3600_000,current={...connection,credentials_encrypted:vault.seal({access_token:"latest",refresh_token:"latest-r",expires_at:future,scope:"User.Read",token_type:"Bearer",capability_tokens:{calendar:{access_token:"calendar",refresh_token:"c",expires_at:future,scope:"Calendars.ReadWrite",token_type:"Bearer"},teams:{access_token:"teams",refresh_token:"t",expires_at:future,scope:"OnlineMeetings.ReadWrite",token_type:"Bearer"},mail:{access_token:"mail",refresh_token:"m",expires_at:future,scope:"Mail.ReadWrite",token_type:"Bearer"}}})};
    assert.equal(await graph.accessToken(current,"calendar"),"calendar");assert.equal(await graph.accessToken(current,"teams"),"teams");assert.equal(await graph.accessToken(current,"mail"),"mail");
  } finally {if(previous===undefined)delete process.env.ORBIT_SECRET_KEY;else process.env.ORBIT_SECRET_KEY=previous;}
});

test("Outlook and Teams register beside Google without changing Calendar Workspace", () => {
  const outlook=new OutlookCalendarPlugin({} as never,{} as never,{} as never),teams=new MicrosoftTeamsPlugin({} as never,{} as never),plugins=new PluginRegistry();
  plugins.register(googleCalendarPluginDefinition(new GoogleCalendarPlugin({} as never,{} as never)));
  plugins.register(outlookCalendarPluginDefinition(outlook));plugins.register(microsoftTeamsPluginDefinition(teams));
  assert.deepEqual(plugins.list().map(item=>item.id),["google_calendar","outlook_calendar","microsoft_teams"]);
  for(const id of ["list_calendars","list_events","get_event","create_event","update_event","delete_event","get_availability"])assert.ok((plugins.getById("outlook_calendar").actions||[]).some(action=>action.id===id),id);
  for(const id of ["create_online_meeting","get_online_meeting","update_online_meeting"])assert.ok((plugins.getById("microsoft_teams").actions||[]).some(action=>action.id===id),id);
  assert.deepEqual(outlook.connectOptions.map(item=>item.id),["calendar","teams","mail"]);
});

test("Outlook adapter normalizes timed, all-day, Windows timezone and Teams conference", () => {
  assert.equal(orbitTimeZone("E. South America Standard Time"),"America/Sao_Paulo");
  assert.equal(microsoftTimeZone("America/New_York"),"Eastern Standard Time");
  assert.equal(graphLocalToDate("2026-10-01T10:00:00","E. South America Standard Time").toISOString(),"2026-10-01T13:00:00.000Z");
  assert.equal(graphLocalToDate("2026-10-01T00:00:00","UTC",true).toISOString(),"2026-10-01T00:00:00.000Z");
  assert.equal(graphDateTime("2026-10-01T13:00:00.000Z","America/Sao_Paulo").dateTime,"2026-10-01T10:00:00");
  const plugin=new OutlookCalendarPlugin({} as never,{} as never,{} as never) as unknown as {conference(event:Record<string,unknown>):Record<string,unknown>;mutation(input:Record<string,unknown>,source:Record<string,unknown>):Record<string,unknown>};
  assert.equal(plugin.conference({isOnlineMeeting:true,onlineMeeting:{joinUrl:"https://teams.microsoft.com/l/meetup-join/test"}}).provider,"microsoft_teams");
  const body=plugin.mutation({title:"Planning",start:"2026-10-01T13:00:00Z",end:"2026-10-01T14:00:00Z",conference:true},{time_zone:"America/Recife"});
  assert.equal(body.isOnlineMeeting,true);assert.equal(body.onlineMeetingProvider,"teamsForBusiness");
});

test("calendar discovery supports multiple Microsoft calendars and accounts", async () => {
  const writes:Array<{sql:string;params:unknown[]}>=[],db={one:async()=>null,query:async(sql:string,params:unknown[]=[])=>{writes.push({sql,params});return []}},graph={connection:async()=>connection,request:async()=>({value:[{id:"personal",name:"Personal",isDefaultCalendar:true,canEdit:true},{id:"shared",name:"Shared",canEdit:false,owner:{address:"shared@example.com"}}]})};
  const plugin=new OutlookCalendarPlugin(db as never,graph as never,{} as never);await plugin.discover(connection.owner_id,connection.id);
  const inserts=writes.filter(call=>call.sql.includes("INSERT INTO calendar_sources"));assert.equal(inserts.length,2);assert.equal(inserts[0].params[1],"outlook_calendar");assert.equal(inserts[1].params[4],"Shared");
});

test("Outlook delta sync paginates and recovers a single invalid cursor with a controlled full sync", async () => {
  const queries:Array<{sql:string;params:unknown[]}>=[],source={id:"00000000-0000-4000-8000-000000000020",owner_id:connection.owner_id,connection_id:connection.id,external_id:"calendar",name:"Calendar",time_zone:"UTC",color:null,selected:true,metadata:{}},calls:string[]=[];
  const db={one:async(sql:string)=>sql.includes("FROM calendar_sources")?source:sql.includes("SELECT * FROM calendar_sync_states")?{cursor:"https://graph.microsoft.com/v1.0/old-delta",window_start:new Date("2026-01-01"),window_end:new Date("2027-01-01")}:null,query:async(sql:string,params:unknown[]=[])=>{queries.push({sql,params});return []}},graph={connection:async()=>connection,request:async(_connection:unknown,path:string)=>{calls.push(path);if(path.includes("old-delta"))throw new MicrosoftGraphError("SYNC_TOKEN_INVALID",410,"expired");if(path.includes("calendarView/delta"))return{value:[],"@odata.nextLink":"https://graph.microsoft.com/v1.0/page-2"};return{value:[],"@odata.deltaLink":"https://graph.microsoft.com/v1.0/new-delta"}}},subscriptions={ensureCalendar:async()=>undefined};
  const plugin=new OutlookCalendarPlugin(db as never,graph as never,subscriptions as never);await plugin.syncSource(source.id);
  assert.equal(calls.length,3);assert.ok(calls[1].includes("calendarView/delta"));assert.equal(calls[2],"https://graph.microsoft.com/v1.0/page-2");assert.ok(queries.some(call=>call.sql.includes("SET cursor=NULL")));assert.ok(queries.some(call=>call.params.includes("https://graph.microsoft.com/v1.0/new-delta")));
});

test("Outlook event CRUD uses Graph, ETags, recurrence and Teams fields", async () => {
  const source={id:"00000000-0000-4000-8000-000000000020",owner_id:connection.owner_id,connection_id:connection.id,external_id:"calendar",name:"Calendar",time_zone:"UTC",color:null,selected:true,metadata:{}},row={id:"00000000-0000-4000-8000-000000000021",source_id:source.id,external_id:"event",connection_id:connection.id,calendar_external_id:"calendar",owner_id:connection.owner_id,name:"Calendar",source_time_zone:"UTC",time_zone:"UTC",color:null,selected:true,source_metadata:{},all_day:false,etag:'W/"etag"'},requests:Array<{path:string;init:RequestInit}>=[],queries:string[]=[];
  const db={one:async(sql:string)=>{queries.push(sql);return sql.includes("SELECT * FROM calendar_sources")?source:row},query:async(sql:string)=>{queries.push(sql);return []}},graph={connection:async()=>connection,request:async(_connection:unknown,path:string,init:RequestInit={})=>{requests.push({path,init});return{id:"event",subject:"Planning",start:{dateTime:"2026-10-01T13:00:00",timeZone:"UTC"},end:{dateTime:"2026-10-01T14:00:00",timeZone:"UTC"},isOnlineMeeting:true,onlineMeeting:{joinUrl:"https://teams.microsoft.com/join"}}}};
  const plugin=new OutlookCalendarPlugin(db as never,graph as never,{} as never);Object.defineProperty(plugin,"persist",{value:async():Promise<CalendarItem>=>({id:row.id,sourceId:source.id,resourceType:"event",title:"Planning",start:"2026-10-01T13:00:00Z",allDay:false,metadata:{}})});
  await plugin.createItem(connection.owner_id,source.id,{title:"Planning",start:"2026-10-01T13:00:00Z",end:"2026-10-01T14:00:00Z",recurrence:[{pattern:{type:"weekly"}} as never],conference:true});
  await plugin.updateItem(connection.owner_id,row.id,{title:"Changed"});await plugin.deleteItem(connection.owner_id,row.id);
  assert.equal(requests[0].init.method,"POST");assert.match(String(requests[0].init.body),/teamsForBusiness/);assert.match(String(requests[0].init.body),/weekly/);assert.equal(requests[1].init.method,"PATCH");assert.deepEqual((requests[1].init.headers as Record<string,string>)["If-Match"],'W/"etag"');assert.equal(requests[2].init.method,"DELETE");assert.ok(queries.some(sql=>sql.includes("status='cancelled'")));
});

test("Graph subscriptions create, validate, deduplicate, renew and delete safely", async () => {
  const previous=process.env.ORBIT_SECRET_KEY;process.env.ORBIT_SECRET_KEY="subscription-secret-at-least-thirty-two-characters";process.env.MICROSOFT_GRAPH_WEBHOOK_URL="https://orbit.example.test/calendar/microsoft/webhook";
  const vault=new SecretVault(),queries:string[]=[],requests:Array<{path:string;method?:string}>=[],source={id:"00000000-0000-4000-8000-000000000020",owner_id:connection.owner_id,connection_id:connection.id,external_id:"calendar"};let subscription:Record<string,unknown>|null=null,receipt=true;
  const db={one:async(sql:string)=>{queries.push(sql);if(sql.includes("FROM external_subscriptions"))return subscription;if(sql.includes("INSERT INTO external_notification_receipts"))return receipt?{fingerprint:"x"}:null;return null},query:async(sql:string)=>{queries.push(sql);if(sql.includes("SELECT * FROM external_subscriptions"))return subscription?[subscription]:[];return []}},graph={connection:async()=>connection,request:async(_connection:unknown,path:string,init:RequestInit={})=>{requests.push({path,method:init.method});if(init.method==="POST")return{id:"subscription",resource:"/me/calendars/calendar/events",expirationDateTime:new Date(Date.now()+5*86400000).toISOString()};if(init.method==="PATCH")return{expirationDateTime:new Date(Date.now()+5*86400000).toISOString()};return undefined}};
  try {
    const manager=new MicrosoftGraphSubscriptionManager(db as never,vault,graph as never);await manager.ensureCalendar(source);assert.ok(requests.some(item=>item.path==="subscriptions"&&item.method==="POST"));
    subscription={id:"local",owner_id:connection.owner_id,connection_id:connection.id,source_id:source.id,external_id:"subscription",resource:"/me/calendars/calendar/events",secret_encrypted:vault.seal({secret:"client-state"}),expires_at:new Date(Date.now()+1000),status:"active",tenant_id:undefined};
    assert.deepEqual(await manager.accept({value:[{subscriptionId:"subscription",clientState:"client-state",changeType:"updated",resource:"events/1",resourceData:{id:"1"}}]}),[source.id]);
    receipt=false;assert.deepEqual(await manager.accept({value:[{subscriptionId:"subscription",clientState:"client-state",changeType:"updated",resource:"events/1",resourceData:{id:"1"}}]}),[]);
    assert.deepEqual(await manager.accept({value:[{subscriptionId:"subscription",clientState:"invalid"},{subscriptionId:"unknown",clientState:"client-state"}]}),[]);
    await manager.renew(subscription as never);assert.ok(requests.some(item=>item.method==="PATCH"));await manager.removeForSource(source.id);assert.ok(requests.some(item=>item.method==="DELETE"));
  } finally {if(previous===undefined)delete process.env.ORBIT_SECRET_KEY;else process.env.ORBIT_SECRET_KEY=previous;delete process.env.MICROSOFT_GRAPH_WEBHOOK_URL;}
});

test("standalone Teams meetings are idempotent resources and reject unsupported accounts", async () => {
  const writes:unknown[][]=[],db={one:async(_sql:string,params:unknown[])=>{writes.push(params);return{id:"resource"}},query:async()=>[]},graph={connection:async()=>connection,request:async()=>({id:"meeting",subject:"Planning",startDateTime:"2026-10-01T13:00:00Z",endDateTime:"2026-10-01T14:00:00Z",joinWebUrl:"https://teams.microsoft.com/l/meetup-join/test"})};
  const teams=new MicrosoftTeamsPlugin(db as never,graph as never),result=await teams.create(connection.owner_id,connection.id,{subject:"Planning",start:"2026-10-01T13:00:00Z",end:"2026-10-01T14:00:00Z"},"00000000-0000-4000-8000-000000000030");
  assert.equal(result.meeting.id,"meeting");assert.equal(writes[0][4],"https://teams.microsoft.com/l/meetup-join/test");
  const personal={...connection,capabilities:{teamsOnlineMeetings:true},metadata:{accountType:"personal"}},blocked=new MicrosoftTeamsPlugin({} as never,{connection:async()=>personal} as never);await assert.rejects(()=>blocked.create(connection.owner_id,connection.id,{subject:"x",start:"2026-10-01",end:"2026-10-02"}),/corporativa ou escolar/);
});
