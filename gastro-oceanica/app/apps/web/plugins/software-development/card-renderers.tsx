"use client";
import {GitActivity,GitCardSection} from './git-card-panel';
import type {CardSlotContribution,CardSlotProps} from '../card-layouts/contract';
function DevelopmentActivity({card,board}:CardSlotProps){return <><GitActivity cardId={card.id}/><GitCardSection cardId={card.id} projectId={card.ai_project_id||board.ai_default_project_id||''}/></>}
export const developmentCardRenderers:CardSlotContribution[]=[{slot:'development.git',component:DevelopmentActivity}];
