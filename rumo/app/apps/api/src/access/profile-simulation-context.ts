import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import type {NextFunction,Request,Response} from 'express';

export type SimulatedProfile={id:string;name:string;permissions:string[]};
export type ProfileSimulationStore={actorId?:string;profile?:SimulatedProfile};
export const profileSimulationContext=new AsyncLocalStorage<ProfileSimulationStore>();

/** Stable, non-account identity used only to label the isolated demo fixture. */
export function simulatedSubjectId(roleId:string){
 const hex=createHash('sha256').update(`orbit-profile-demo:${roleId}`).digest('hex').slice(0,32);
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

/** Static, clearly marked demo data. It is never persisted or joined to users. */
export function simulatedDemoContext(profile:SimulatedProfile,effectivePermissions=profile.permissions){
 const subjectId=simulatedSubjectId(profile.id);
 const tag=`DEMO · ${profile.name}`;
 const grants=new Set(effectivePermissions);
 const allowed=(permission:string)=>grants.has('*')||grants.has(permission);
 return {
  mode:'read_only_demo' as const,
  product:'Orbit',
  role:{id:profile.id,name:profile.name,permissions:[...effectivePermissions]},
  persona:{id:subjectId,name:`${tag} · Pessoa de exemplo`,email:`${profile.id}@demo.invalid`},
  workspace:{id:simulatedSubjectId(`${profile.id}:workspace`),name:`${tag} · Operação de exemplo`},
  records:[
   {id:simulatedSubjectId(`${profile.id}:record:inbox`),title:'Revisar solicitação de acesso',type:'task',state:'new',description:'Exemplo fictício para demonstrar as permissões deste perfil.',is_demo:true},
   {id:simulatedSubjectId(`${profile.id}:record:progress`),title:'Preparar resumo semanal',type:'task',state:'in_progress',description:'Dados demonstrativos; nenhuma pessoa ou operação real está envolvida.',is_demo:true},
   {id:simulatedSubjectId(`${profile.id}:record:done`),title:'Confirmar rotina de acompanhamento',type:'task',state:'done',description:'Exemplo fictício concluído.',is_demo:true},
  ],
  flows:[
   {id:'boards.read',label:'Consultar tarefas de exemplo',available:allowed('boards.read'),permission:'boards.read'},
   {id:'boards.write',label:'Editar tarefas de exemplo',available:allowed('boards.write'),permission:'boards.write'},
   {id:'access.manage',label:'Gerenciar acessos de exemplo',available:allowed('access.manage'),permission:'access.manage'},
   {id:'access.audit.read',label:'Consultar auditoria de exemplo',available:allowed('access.audit.read'),permission:'access.audit.read'},
   {id:'vault.read',label:'Consultar arquivos de exemplo',available:allowed('vault.read'),permission:'vault.read'},
   {id:'ai.read',label:'Consultar atividades de IA de exemplo',available:allowed('ai.read'),permission:'ai.read'},
  ],
  message:'Este contexto contém apenas dados fictícios. As rotas de domínio permanecem bloqueadas até usarem este fixture isolado.',
 };
}

export function profileSimulationMiddleware(_req:Request,_res:Response,next:NextFunction){
 profileSimulationContext.run({},next);
}

export function currentSimulatedProfile(actorId?:string){
 const store=profileSimulationContext.getStore();
 return actorId&&store?.actorId===actorId?store.profile:undefined;
}
