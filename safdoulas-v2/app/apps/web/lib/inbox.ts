import {send,type Card} from './api';
export function inboxCardIds(cards:Array<Pick<Card,'id'|'kind'|'source_card_id'>>){return [...new Set(cards.map(card=>card.kind==='mirror'&&card.source_card_id?card.source_card_id:card.id))]}
export async function assignCardsToInbox(cards:Array<Pick<Card,'id'|'kind'|'source_card_id'>>){
 const result=await send('/inbox/cards','POST',{card_ids:inboxCardIds(cards)});
 window.dispatchEvent(new Event('data:changed'));window.dispatchEvent(new Event('inbox:show'));
 return result;
}
