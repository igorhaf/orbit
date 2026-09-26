export const events = ['card_created','card_moved','card_updated','card_completed','due_changed','label_changed','member_changed','comment_added','field_changed','checklist_changed'] as const;
export const actionTypes = ['move','label_add','label_remove','assign','unassign','complete','archive','rename','description','comment','due','start','field','checklist_add','checklist_complete','sort','report'] as const;
export type Condition = {field:string; op:'eq'|'neq'|'contains'|'not_contains'|'gt'|'lt'|'empty'|'not_empty'; value?:string};
export type AutomationAction = {type:typeof actionTypes[number]; value?:string; field?:string; target?:'card'|'board'|'list'|'related'; listId?:string; report?:'snapshot'|'due_soon'|'overdue'|'my_cards'|'custom'; recipients?:string; subject?:string; template?:string};
export type Definition = {
  trigger:{type:'event'|'card_button'|'board_button'|'scheduled'|'due';event?:string;listId?:string;offsetMinutes?:number;frequency?:'daily'|'weekly'|'interval';time?:string;timezone?:string;weekday?:number;intervalMinutes?:number};
  conditions:Condition[]; actions:AutomationAction[];
};
export type Context = {title:string;description:string;list_id:string;list:string;board:string;completed:boolean;due_date:string|null;labels:string[];members:string[];fields:Record<string,unknown>;user:string;[key:string]:unknown};
const idPattern=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export function isId(value:unknown):value is string {return typeof value==='string'&&idPattern.test(value)}
export function validateDefinition(input:unknown):Definition {
  const d=input as Definition;
  if(!d||!d.trigger||!['event','card_button','board_button','scheduled','due'].includes(d.trigger.type))throw new Error('Gatilho inválido.');
  const t=d.trigger;
  if(t.type==='event'&&!events.includes(t.event as typeof events[number]))throw new Error('Evento inválido.');
  if(t.listId&&!isId(t.listId))throw new Error('Lista inválida.');
  if(t.type==='due'&&(!Number.isInteger(t.offsetMinutes)||Math.abs(t.offsetMinutes!)>525600))throw new Error('Informe os minutos em relação ao vencimento.');
  if(t.type==='scheduled'){
    if(!['daily','weekly','interval'].includes(t.frequency||''))throw new Error('Frequência inválida.');
    if(t.frequency==='interval'){
      if(!Number.isInteger(t.intervalMinutes)||t.intervalMinutes!<5||t.intervalMinutes!>525600)throw new Error('Intervalo: 5 a 525600 minutos.');
    }else{
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time||''))throw new Error('Horário inválido.');
      try{new Intl.DateTimeFormat('en',{timeZone:t.timezone||'UTC'}).format()}catch{throw new Error('Fuso horário inválido.')}
      if(t.frequency==='weekly'&&(!Number.isInteger(t.weekday)||t.weekday!<0||t.weekday!>6))throw new Error('Dia da semana inválido.');
    }
  }
  if(!Array.isArray(d.conditions)||d.conditions.length>30)throw new Error('Use até 30 condições.');
  for(const c of d.conditions){
    if(!c||typeof c.field!=='string'||!['eq','neq','contains','not_contains','gt','lt','empty','not_empty'].includes(c.op)||!(['title','description','list_id','completed','due_date','labels','members','archived'].includes(c.field)||/^custom:[\da-f-]{36}$/i.test(c.field))|| (c.value!==undefined&&(typeof c.value!=='string'||c.value.length>1000)))throw new Error('Condição inválida.');
  }
  if(!Array.isArray(d.actions)||d.actions.length<1||d.actions.length>20)throw new Error('Use entre 1 e 20 ações.');
  for(const a of d.actions){
    if(!a||!actionTypes.includes(a.type)||!['card','board','list','related'].includes(a.target||'card'))throw new Error('Ação inválida.');
    if(['scheduled','board_button'].includes(t.type)&&['card','related'].includes(a.target||''))throw new Error('Este gatilho exige uma lista ou o quadro como alvo.');
    for(const key of ['value','field','listId','recipients','subject','template'] as const)if(a[key]!==undefined&&(typeof a[key]!=='string'||a[key]!.length>10000))throw new Error('Texto de ação inválido.');
    if(a.target==='list'&&!isId(a.listId))throw new Error('Selecione a lista alvo.');
    if(['move','label_add','label_remove','assign','unassign'].includes(a.type)&&!isId(a.value))throw new Error('Selecione o destino da ação.');
    if(a.type==='field'&&!isId(a.field))throw new Error('Selecione o campo personalizado.');
    if(a.type==='sort'&&!['title','due_date','created_at'].includes(a.value||''))throw new Error('Ordenação inválida.');
    if(a.type==='complete'&&!['true','false'].includes(a.value||''))throw new Error('Status inválido.');
    if(['rename','comment','checklist_add'].includes(a.type)&&!a.value?.trim())throw new Error('Informe o texto da ação.');
    if(a.type==='report'){
      const recipients=(a.recipients||'').split(',').map(x=>x.trim());
      if(recipients.length>10||recipients.some(x=>!/^\S+@[^\s@]+\.[^\s@]+$/.test(x)||/[\r\n]/.test(x)))throw new Error('Informe de 1 a 10 e-mails separados por vírgula.');
      if(!['snapshot','due_soon','overdue','my_cards','custom'].includes(a.report||''))throw new Error('Modelo de relatório inválido.');
      if(/[\r\n]/.test(a.subject||''))throw new Error('Assunto inválido.');
    }
  }
  return d;
}
export function matches(context:Context,conditions:Condition[],now=new Date()):boolean {
  return conditions.every(c=>{
    const raw=c.field.startsWith('custom:')?context.fields[c.field.slice(7)]:context[c.field];
    const expected=interpolate(c.value||'',context,now);
    const actual=raw==null?'':String(raw);
    switch(c.op){
      case 'empty':return raw==null||actual===''||(Array.isArray(raw)&&raw.length===0);
      case 'not_empty':return raw!=null&&actual!==''&&(!Array.isArray(raw)||raw.length>0);
      case 'contains':return Array.isArray(raw)?raw.includes(expected):actual.toLowerCase().includes(expected.toLowerCase());
      case 'not_contains':return Array.isArray(raw)?!raw.includes(expected):!actual.toLowerCase().includes(expected.toLowerCase());
      case 'eq':return actual===expected;
      case 'neq':return actual!==expected;
      default:{const a=Number(actual),b=Number(expected);const left=Number.isFinite(a)&&actual!==''?a:Date.parse(actual),right=Number.isFinite(b)&&expected!==''?b:Date.parse(expected);return c.op==='gt'?left>right:left<right;}
    }
  });
}
export function dateExpression(expression:string,now=new Date(),due?:string|null):Date {
  const match=/^(now|today|due)(?:\s*([+-])\s*(\d+)\s*(minutes?|hours?|days?|business_days?))?$/.exec(expression);
  if(!match){const date=new Date(expression);if(!Number.isFinite(date.getTime()))throw new Error('Data inválida. Use now + 2 days ou uma data ISO.');return date}
  const date=match[1]==='due'?new Date(due||''):new Date(now);
  if(!Number.isFinite(date.getTime()))throw new Error('O cartão não possui vencimento.');
  if(match[1]==='today')date.setUTCHours(0,0,0,0);
  const amount=Number(match[3]||0),direction=match[2]==='-'?-1:1;
  if(amount>525600)throw new Error('Cálculo de data excede o limite.');
  if(match[4]?.startsWith('business_day')){
    if(amount>3660)throw new Error('Limite de 3660 dias úteis.');
    for(let i=0;i<amount;){date.setUTCDate(date.getUTCDate()+direction);if(![0,6].includes(date.getUTCDay()))i++;}
  }else date.setTime(date.getTime()+direction*amount*(match[4]?.startsWith('minute')?60000:match[4]?.startsWith('hour')?3600000:86400000));
  return date;
}
export function interpolate(text:string,context:Context,now=new Date()):string {
  return text.replace(/\{\{([^{}]+)\}\}/g,(_,token:string)=>{
    const [name,format]=token.trim().split('|').map(x=>x.trim());
    if(/^(now|today|due)(\s|$)/.test(name)){
      const d=dateExpression(name,now,context.due_date);
      if(format==='date')return d.toISOString().slice(0,10);
      if(format==='time')return d.toISOString().slice(11,16);
      if(format&&format!=='iso')throw new Error('Formato de data: iso, date ou time.');
      return d.toISOString();
    }
    const value=name.startsWith('custom:')?context.fields[name.slice(7)]:context[name];
    if(value===undefined)throw new Error(`Variável desconhecida: ${name}`);
    return Array.isArray(value)?value.join(', '):String(value??'');
  });
}
export function nextSchedule(t:Definition['trigger'],after=new Date()):Date {
  if(t.frequency==='interval')return new Date(after.getTime()+(t.intervalMinutes||60)*60000);
  const formatter=new Intl.DateTimeFormat('en-US',{timeZone:t.timezone||'UTC',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const date=new Date(Math.floor(after.getTime()/60000)*60000+60000);
  for(let i=0;i<8*24*60;i++,date.setTime(date.getTime()+60000)){
    const parts=Object.fromEntries(formatter.formatToParts(date).map(p=>[p.type,p.value]));
    if(`${parts.hour}:${parts.minute}`===t.time&&(t.frequency!=='weekly'||parts.weekday===['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][t.weekday!]))return date;
  }
  throw new Error('Não foi possível calcular o próximo agendamento.');
}
