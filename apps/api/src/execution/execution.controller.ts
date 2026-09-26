import {Body,Controller,Get,Inject,Param,Patch,Post,Query,Req} from '@nestjs/common';
import {Request} from 'express';
import {FeaturesService} from '../features';
import {CardExecutionService} from './execution.service';
import {ProjectRegistry} from './project-registry';
import {AutomationsService} from '../automations';
@Controller()
export class CardExecutionController {
  constructor(@Inject(CardExecutionService) private service:CardExecutionService,@Inject(FeaturesService) private features:FeaturesService,@Inject(ProjectRegistry) private projects:ProjectRegistry,@Inject(AutomationsService) private automations:AutomationsService){}
  @Get('execution/catalog') catalog(@Req() r:Request,@Query('project_id') id?:string){return this.service.catalog(this.features.user(r),id)}
  @Get('cards/:id/execution') details(@Req() r:Request,@Param('id') id:string){return this.service.details(id,this.features.user(r))}
  @Patch('cards/:id/execution') save(@Req() r:Request,@Param('id') id:string,@Body() body:unknown){return this.service.save(id,this.features.user(r),body)}
  @Post('cards/:id/runs') run(@Req() r:Request,@Param('id') id:string,@Body() body:{request_key?:string}){return this.service.enqueue(id,this.features.user(r),body)}
  @Get('execution/runs/:id') history(@Req() r:Request,@Param('id') id:string){return this.service.runDetail(id,this.features.user(r))}
  @Post('execution/runs/:id/cancel') cancel(@Req() r:Request,@Param('id') id:string){return this.service.cancel(id,this.features.user(r))}
  @Post('execution/projects/:project/automations/:template') async importAutomation(@Req() r:Request,@Param('project') id:string,@Param('template') template:string,@Body() body:{board_id:string}){
    const user=this.features.user(r),project=await this.projects.get(id,user),resource=await this.projects.document(project,'automations',template);
    return this.automations.save(body.board_id,user,{name:String(resource.metadata.name||template),enabled:false,definition:resource.metadata});
  }
}
