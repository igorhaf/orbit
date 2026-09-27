import {PluginRegistry} from './registries';
import {ExecutionInput,ExecutionResult,Executor} from './types';

export class PluginActionExecutor implements Executor {
  readonly id='plugin';
  readonly name='Actions de plugins';
  readonly actions=[{id:'execute',name:'Executar actions configuradas',permissions:[]}];
  constructor(private readonly plugins:PluginRegistry){}
  async execute(input:ExecutionInput):Promise<ExecutionResult>{
    if(!input.integrations?.length)throw new Error('Adicione ao menos uma action de plugin.');
    const outputs=[];
    for(const integration of input.integrations){
      if(input.signal.aborted)throw new Error('Execução cancelada.');
      outputs.push(await this.plugins.execute(integration,input));
    }
    return {summary:`${outputs.length} action(s) de plugin executada(s).`,outputs};
  }
}
