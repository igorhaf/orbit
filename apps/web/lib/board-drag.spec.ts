import test from 'node:test';
import assert from 'node:assert/strict';
import {boardCollisionDetection} from './board-drag';
import {inboxCardIds} from './inbox';
import type {CollisionDetection} from '@dnd-kit/core';
const rect=(left:number,top:number,width:number,height:number)=>({left,top,width,height,right:left+width,bottom:top+height});
function detect(view:string,x:number,y:number){
 const args={active:{id:'card:task',data:{current:{type:'card',view}}},collisionRect:rect(x,y,50,50),pointerCoordinates:{x,y},droppableRects:new Map([['inbox:tab',rect(0,0,200,60)],['list:list',rect(250,0,300,500)]]),droppableContainers:[{id:'inbox:tab',data:{current:{type:'inbox'}}},{id:'list:list',data:{current:{type:'list'}}}]} as unknown as Parameters<CollisionDetection>[0];
 return boardCollisionDetection(args).map(result=>result.id);
}
for(const view of ['structured','board'])test(`${view} dragging prioritizes Inbox and does not catch drops outside it`,()=>{
 assert.deepEqual(detect(view,40,25),['inbox:tab']);assert.deepEqual(detect(view,300,100),['list:list']);
});
test('Inbox assignment resolves mirrors to their source and removes duplicate selections',()=>{
 assert.deepEqual(inboxCardIds([{id:'a'},{id:'b',kind:'mirror',source_card_id:'a'},{id:'c'}]),['a','c']);
});
