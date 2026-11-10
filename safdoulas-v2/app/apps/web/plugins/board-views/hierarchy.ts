import type {Card} from '@/lib/api';
import type {ContextLink} from './contract';

// Only explicit primary-parent links organize the tree. Context associations
// never choose the parent or create extra occurrences.
export function cardHierarchy(cards:Card[],links:ContextLink[]){
  const ids=new Set(cards.map(card=>card.id)),parents=new Map<string,string[]>();
  const reaches=(from:string,to:string)=>{const pending=[from],seen=new Set<string>();while(pending.length){const id=pending.pop()!;if(id===to)return true;if(seen.has(id))continue;seen.add(id);pending.push(...parents.get(id)||[])}return false};
  for(const link of [...links].sort((a,b)=>a.position-b.position||a.contextId.localeCompare(b.contextId)||a.cardId.localeCompare(b.cardId))){
    if(!ids.has(link.cardId)||!ids.has(link.contextId)||link.cardId===link.contextId||parents.has(link.cardId)||reaches(link.contextId,link.cardId))continue;
    parents.set(link.cardId,[link.contextId]);
  }
  const children=new Map<string,Card[]>();
  for(const card of cards)for(const key of parents.get(card.id)||[''])children.set(key,[...(children.get(key)||[]),card]);
  return {parents,children};
}

export function structuredRows(cards:Card[],graph:ReturnType<typeof cardHierarchy>,matching:Set<string>,hierarchy:boolean,collapsed:string[]){
  type Row={card:Card;depth:number;contextOnly:boolean;key:string;parentId?:string};
  if(!hierarchy)return cards.filter(card=>matching.has(card.id)).map(card=>({card,depth:0,contextOnly:false,key:card.id})) as Row[];
  const visible=new Set(matching),pending=[...matching];
  while(pending.length)for(const parent of graph.parents.get(pending.pop()!)||[])if(!visible.has(parent)){visible.add(parent);pending.push(parent)}
  const rows:Row[]=[],stack=(graph.children.get('')||[]).slice().reverse().map(card=>({card,depth:0,key:card.id,parentId:undefined as string|undefined}));
  while(stack.length){const row=stack.pop()!;if(!visible.has(row.card.id))continue;rows.push({...row,contextOnly:!matching.has(row.card.id)});if(!collapsed.includes(row.key))for(const card of (graph.children.get(row.card.id)||[]).slice().reverse())stack.push({card,depth:row.depth+1,key:card.id,parentId:row.card.id})}
  return rows;
}
