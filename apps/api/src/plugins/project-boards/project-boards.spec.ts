import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import type {Request,Response,NextFunction} from 'express';
import {PluginRegistry} from '../../execution/registries';
import {projectBoardsPlugin,projectBoardCreationAccess,isProjectBoardCreation} from './project-boards.plugin';

test('creation detaches without disabling reads, edits, cards or domain workflows',()=>{
 const registry=new PluginRegistry();registry.register(projectBoardsPlugin);
 const middleware=projectBoardCreationAccess(registry);
 for(const path of ['/boards','/boards/','/boards/id/copy','/ai/projects','/ai/projects/directories']){
  assert.equal(isProjectBoardCreation(path,'POST'),true);
  let passed=false;let status=0;
  const response={status(code:number){status=code;return this},json(){return this}} as unknown as Response;
  const next=(()=>{passed=true}) as NextFunction;
  middleware({path,method:'POST'} as Request,response,next);assert.equal(passed,true);
  registry.setEnabled('project-boards',false);passed=false;
  middleware({path,method:'POST'} as Request,response,next);assert.equal(passed,false);assert.equal(status,409);
  registry.setEnabled('project-boards',true);
 }
 registry.setEnabled('project-boards',false);
 for(const [path,method] of [['/boards','GET'],['/boards/id','PATCH'],['/boards/id/cards','POST'],['/ai/projects/id','PATCH'],['/safdoulas/processes','POST']]){
  let passed=false;middleware({path,method} as Request,{} as Response,(()=>{passed=true}) as NextFunction);assert.equal(passed,true);
 }
 assert.equal(registry.isEnabled('project-boards'),false);
 registry.setEnabled('project-boards',true);assert.equal(registry.isEnabled('project-boards'),true);
});
