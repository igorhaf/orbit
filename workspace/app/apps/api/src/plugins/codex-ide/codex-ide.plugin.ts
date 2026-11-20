import type {PluginDefinition} from '../contract';
export const codexIdePlugin:PluginDefinition={
 id:'codex-ide',name:'Codex no Orbit',version:'2.0.0',
 description:'Conversas com Codex, histórico, revisão, anexos, comandos e aprovações no painel lateral.',
 dependencies:['ai'],handlesRoute:path=>/^\/codex-ide(?:\/|$)/.test(path),
 routePermission:(_path,method)=>['GET','HEAD'].includes(method)?'codex.ide.read':'codex.ide.write',
 capabilities:[{id:'codex.ide',name:'Conversar com Codex',permissions:['codex.ide.read','codex.ide.write']},{id:'codex.ide.full',name:'Permitir acesso completo do Codex ao servidor',permissions:['codex.ide.full']}],
};
