import { Global, Module } from '@nestjs/common';
import { CodexAiService } from './codex-provider';
import type { PluginDefinition } from '../contract';
export const aiPlugin:PluginDefinition={id:'ai',name:'Inteligência artificial',version:'1.0.0',description:'Assistência de texto, diálogo e execução com provedores de IA.',configuration:[{key:'CODEX_BIN',label:'Executável Codex',secret:false},{key:'CODEX_AI_TIMEOUT_MS',label:'Tempo limite de IA (ms)',secret:false}],capabilities:[{id:'ai.settings',name:'Configurações e filas de IA',permissions:['ai.read','queues.read','queues.write']},{id:'ai.assistance',name:'Assistência de IA',permissions:['ai.write']}],contributions:{cardLayouts:[{id:'ai.assistant',name:'Assistente de IA',slots:['ai.controls','ai.comments','ai.prompt','ai.execution']} ]}};
@Global()
@Module({providers:[CodexAiService],exports:[CodexAiService]})
export class AiPluginModule {}

export function aiPluginDefinition(provider:Pick<CodexAiService,'complete'>):PluginDefinition{
 return {...aiPlugin,actions:[{id:'complete',name:'Gerar resposta de IA',permissions:['ai.write'],requiredCapabilities:['ai.assistance'],inputSchema:{type:'object',properties:{instruction:{type:'string',minLength:1,maxLength:20000},model:{type:'string'},effort:{type:'string',enum:['low','medium','high','xhigh']}},required:['instruction'],additionalProperties:false},async execute(input){return {type:'text',value:await provider.complete(String(input.instruction),input.model as string|undefined,input.effort as string|undefined)}}}]};
}
