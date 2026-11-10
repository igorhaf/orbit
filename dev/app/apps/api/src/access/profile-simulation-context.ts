import {AsyncLocalStorage} from 'node:async_hooks';
import type {NextFunction,Request,Response} from 'express';

export type SimulatedProfile={id:string;name:string;permissions:string[]};
export type ProfileSimulationStore={actorId?:string;profile?:SimulatedProfile};
export const profileSimulationContext=new AsyncLocalStorage<ProfileSimulationStore>();

export function profileSimulationMiddleware(_req:Request,_res:Response,next:NextFunction){
 profileSimulationContext.run({},next);
}

export function currentSimulatedProfile(actorId?:string){
 const store=profileSimulationContext.getStore();
 return actorId&&store?.actorId===actorId?store.profile:undefined;
}
