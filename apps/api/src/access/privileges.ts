export type Privilege={id:string;label:string;source:string};
const families:Record<string,string>={boards:'Quadros, listas, cartões, comentários e anexos',vault:'Cofre',notebooks:'Cadernos',projects:'Projetos',backups:'Backups',search:'Pesquisa',calendar:'Calendário',tools:'Diagnóstico de ferramentas',notifications:'Notificações',trash:'Lixeira',account:'Conta e preferências',ai:'Inteligência artificial',execution:'Execuções',settings:'Configurações do sistema',queues:'Filas',architecture:'Arquitetura',exports:'Exportações',email:'Entrada de cartões por e-mail'};
export const corePrivileges:Privilege[]=[{id:'projects.filesystem',label:'Navegar e criar pastas do host para projetos',source:'core'},{id:'access.manage',label:'Administrar usuários, grupos, perfis e privilégios',source:'core'},{id:'plugins.read',label:'Visualizar plugins',source:'core'},{id:'plugins.manage',label:'Administrar instalação e configuração de plugins',source:'core'},...Object.entries(families).flatMap(([id,label])=>[{id:id+'.read',label:'Visualizar '+label,source:id==='ai'||id==='queues'?'ai':'core'},{id:id+'.write',label:'Alterar '+label,source:id==='ai'||id==='queues'?'ai':'core'}])];
export function permissionForRoute(path:string,method:string){
 const read=['GET','HEAD'].includes(method),action=read?'read':'write';
 if(path.startsWith('/access'))return path==='/access/me'?null:'access.manage';
 if(path==='/auth/me')return null;
 if(path==='/plugins')return read?'plugins.read':'plugins.manage';
 if(path.startsWith('/plugins/'))return 'plugins.manage';
 if(/^\/(boards|cards|lists|comments|checklists|checklist-items|checklist|card-attachments|comment-attachments|card-merges|favorites)(\/|$)/.test(path))return 'boards.'+action;
 if(path==='/home')return 'boards.read';
 if(/^\/ai\/projects\/directories(\/|$)/.test(path))return 'projects.filesystem';
 if(/^\/ai\/projects(\/|$)/.test(path))return 'projects.'+action;
 if(/^\/(env|environment|integrations)(\/|$)/.test(path))return 'settings.'+action;
 if(/^\/codex\/queues?(\/|$)/.test(path))return 'queues.'+action;
 if(/^\/codex\/limits(\/|$)/.test(path))return 'ai.read';
 if(/^\/codex(\/|$)/.test(path))return 'ai.'+action;
 if(/^\/(saved-searches|search)(\/|$)/.test(path))return 'search.'+action;
 const family=path.split('/')[1];return families[family]?family+'.'+action:'root.only';
}
export function evaluatePermissions(root:boolean,rolePermissions:string[],groupPermissions:string[],exceptions:Array<{permission_id:string;effect:string}>,disabled:string[],catalog:string[],admin=false){
 if(root)return ['*'];const effective=new Set(admin?catalog:[...rolePermissions,...groupPermissions]);
 for(const exception of exceptions)if(exception.effect==='allow')effective.add(exception.permission_id);
 for(const exception of exceptions)if(exception.effect==='deny')effective.delete(exception.permission_id);
 for(const permission of disabled)effective.delete(permission);
 return [...effective].filter(permission=>catalog.includes(permission));
}
