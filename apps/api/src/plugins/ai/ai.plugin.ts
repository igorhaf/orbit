import { Global, Module } from '@nestjs/common';
import { CodexAiService } from './codex-provider';
import { OrbitEmbeddingsService } from './embeddings';
import { OrbitKnowledgeRetrievalService } from './knowledge-retrieval';
import { isAiRoute } from './routes';
import type { PluginDefinition } from '../contract';
const ownsAiRoute=(path:string)=>isAiRoute(path);
export const aiPlugin:PluginDefinition={id:'ai',name:'Inteligência artificial',version:'1.0.0',description:'Assistência de texto, diálogo, busca semântica e execução com provedores de IA.',handlesRoute:ownsAiRoute,routePermission:(path,method)=>`${/^\/codex\/queues?(?:\/|$)/.test(path)?'queues':'ai'}.${['GET','HEAD'].includes(method)?'read':'write'}`,configuration:[{key:'CODEX_BIN',label:'Executável Codex',secret:false},{key:'CODEX_AI_TIMEOUT_MS',label:'Tempo limite de IA (ms)',secret:false},{key:'ORBIT_AI_EMBEDDINGS_ENABLED',label:'Ativar busca semântica com embeddings',secret:false},{key:'ORBIT_OPENAI_EMBEDDINGS_API_KEY',label:'Chave da API de embeddings',secret:true}],capabilities:[{id:'ai.settings',name:'Configurações e filas de IA',permissions:['ai.read','queues.read','queues.write']},{id:'ai.assistance',name:'Assistência de IA',permissions:['ai.write']}],contributions:{cardLayouts:[{id:'ai.assistant',name:'Assistente de IA',slots:['ai.controls','ai.comments','ai.prompt','ai.execution']} ]}};
@Global()
@Module({
 providers:[CodexAiService,OrbitEmbeddingsService],
 exports:[CodexAiService,OrbitEmbeddingsService],
})
export class AiPluginModule {}

// Retrieval remains a plain service so host plugins pass their authorized
// candidates explicitly; it never queries or authorizes host-owned content.
export { OrbitKnowledgeRetrievalService };

export function aiPluginDefinition(provider:Pick<CodexAiService,'complete'>):PluginDefinition{
 return {...aiPlugin,actions:[{id:'complete',name:'Gerar resposta de IA',permissions:['ai.write'],requiredCapabilities:['ai.assistance'],inputSchema:{type:'object',properties:{instruction:{type:'string',minLength:1,maxLength:20000},model:{type:'string'},effort:{type:'string',enum:['low','medium','high','xhigh']}},required:['instruction'],additionalProperties:false},async execute(input){return {type:'text',value:await provider.complete(String(input.instruction),input.model as string|undefined,input.effort as string|undefined)}}}]};
}
