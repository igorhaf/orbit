import type {Board,Card} from '@/lib/api';
import type {ReactNode} from 'react';
export type SavedBoardFilter={id:string;name:string;query:string;listId:string;assignee:string;labelId:string;due:string};
export type BoardView={id:string;name:string;renderer:string;permission:string;pluginId:string};
export type BoardViewState={canWrite:boolean;views:BoardView[];preferredViewId:string|null;savedFilters:SavedBoardFilter[]};
export type ContextLink={cardId:string;contextId:string;position:number};
export type BoardViewProps={
  canWrite:boolean;board:Board;userId?:string;query:string;fieldFilter:string;labelFilter:string;dueFilter:string;
  onOpen:(card:Card)=>void;onAdd:(listId:string,title:string,position:number,typeId?:string)=>Promise<Card|undefined>;
  cardTypes:Array<{id:string;name:string}>;savedFilters:SavedBoardFilter[];
  onSaveFilters:(filters:SavedBoardFilter[])=>Promise<void>;
  selectionMode:boolean;selection:string[];children?:ReactNode;
};
