export const reminderOptions = new Set([0,5,10,15,30,60,1440,2880,10080]);
export const recurrenceOptions = new Set(['daily','weekly','monthly','yearly']);
export const labelColorOptions = new Set([
  'none',
  ...['green','yellow','orange','red','purple','blue','pink','teal','lime','gray']
    .flatMap(color=>[color,`${color}_light`,`${color}_dark`]),
]);

export type TitleKind = {kind:'normal'|'separator'|'board'|'link';targetBoardId:string|null;linkUrl:string|null};
export function cardKindFromTitle(title:string,appOrigin:string):TitleKind {
  if(title.trim()==='---')return {kind:'separator',targetBoardId:null,linkUrl:null};
  const candidate=title.trim();
  if(!/^https?:\/\//i.test(candidate)&&!candidate.startsWith('/board/'))return {kind:'normal',targetBoardId:null,linkUrl:null};
  try{
    const url=new URL(candidate,appOrigin);
    if(!['http:','https:'].includes(url.protocol))return {kind:'normal',targetBoardId:null,linkUrl:null};
    const board=/^\/board\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(url.pathname);
    if(url.origin===new URL(appOrigin).origin&&board&&!url.searchParams.has('card'))return {kind:'board',targetBoardId:board[1],linkUrl:null};
    return {kind:'link',targetBoardId:null,linkUrl:url.toString()};
  }catch{return {kind:'normal',targetBoardId:null,linkUrl:null}}
}

export function dueDateFromTitle(title: string): Date | null {
  const match=title.match(/\b(\d{4})-(\d{2})-(\d{2})\b/) || title.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (!match) return null;
  const iso=match[0].includes('-');
  const year=Number(iso?match[1]:match[3]);
  const month=Number(iso?match[2]:match[2]);
  const day=Number(iso?match[3]:match[1]);
  const check=new Date(Date.UTC(year,month-1,day));
  if (check.getUTCFullYear()!==year || check.getUTCMonth()!==month-1 || check.getUTCDate()!==day) return null;
  return new Date(`${year.toString().padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T23:59:00-03:00`);
}

function step(date: Date, cadence: string): Date {
  const next=new Date(date);
  if (cadence==='daily') next.setUTCDate(next.getUTCDate()+1);
  else if (cadence==='weekly') next.setUTCDate(next.getUTCDate()+7);
  else {
    const day=next.getUTCDate();
    next.setUTCDate(1);
    if (cadence==='monthly') next.setUTCMonth(next.getUTCMonth()+1);
    else next.setUTCFullYear(next.getUTCFullYear()+1);
    const last=new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth()+1,0)).getUTCDate();
    next.setUTCDate(Math.min(day,last));
  }
  return next;
}

export function nextOccurrence(dueDate: Date, cadence: string, now=new Date()): Date {
  let next=step(dueDate,cadence);
  while (next<=now) next=step(next,cadence);
  return next;
}
