import type {ComponentType} from 'react';
import type {Board,Card} from '@/lib/api';
export type CardSlotProps={card:Card;board:Board;onChanged:()=>Promise<void>;onApply?:(text:string,action?:string)=>Promise<void>;variant?:string;aiLocked?:boolean;onExecutionStart?:()=>void;onExecutionEnd?:()=>void;onAiActionStart?:()=>void};
export type CardSlotContribution={slot:string;component:ComponentType<CardSlotProps>};
