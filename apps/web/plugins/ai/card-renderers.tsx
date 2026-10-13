"use client";
import {CardAi} from './card-ai';
import type {CardSlotContribution,CardSlotProps} from '../card-layouts/contract';
function AiControls(props:CardSlotProps){if(!props.onApply)return null;return <CardAi {...props} onApply={props.onApply} variant={props.variant==='text'?'text':'settings'}/>}
export const aiCardRenderers:CardSlotContribution[]=[{slot:'ai.controls',component:AiControls}];
