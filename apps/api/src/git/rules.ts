export const gitTypes=['feat','fix','chore'] as const;
export type GitType=typeof gitTypes[number];
export function branchName(input:unknown):string{
  if(typeof input!=='string'||input.length>255||!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(input)||input.includes('..')||input.includes('//')||input.includes('@{')||input.endsWith('/')||input.endsWith('.')||input.endsWith('.lock'))throw new Error('Branch inválida.');
  return input;
}
export function branches(input:unknown):string[]{
  if(!Array.isArray(input)||input.length===0||input.length>30)throw new Error('Configure entre 1 e 30 branches.');
  const names=input.map(branchName);
  if(new Set(names).size!==names.length)throw new Error('Branches repetidas.');
  return names;
}
export function allowedBranch(branch:string,repositoryBranches:string[],pipelineBranches?:string[]){
  if(!repositoryBranches.includes(branch)||pipelineBranches&&!pipelineBranches.includes(branch))throw new Error(`A branch ${branch} não está configurada para esta operação.`);
  return branch;
}
export function gitPaths(input:unknown):string[]{
  if(!Array.isArray(input)||input.length===0||input.length>100)throw new Error('Selecione de 1 a 100 arquivos.');
  const paths=input.map(path=>{
    if(typeof path!=='string'||path.length>1000||!path||path.startsWith('-')||path.startsWith('/')||path.includes('\\')||path.includes('\0')||[':','*','?','[',']'].some(char=>path.includes(char))||path.split('/').some(part=>!part||part==='.'||part==='..'||part==='.git'||part==='.env'||part.startsWith('.env.')))throw new Error('Caminho de arquivo inválido.');
    return path;
  });
  return [...new Set(paths)];
}
export function conventionalMessage(type:unknown,subject:unknown,files:string[],shortstat:string){
  if(!gitTypes.includes(type as GitType))throw new Error('Tipo de commit inválido.');
  if(typeof subject!=='string'||!subject.trim())throw new Error('Título do commit obrigatório.');
  const title=subject.trim().replace(/\s+/g,' ').replace(/^(feat|fix|chore)(\([^)]+\))?!?:\s*/i,'').slice(0,100);
  const fileLine=`Arquivos: ${files.slice(0,6).join(', ')}${files.length>6?` e mais ${files.length-6}`:''}`.slice(0,180);
  const statLine=shortstat.trim().replace(/\s+/g,' ').slice(0,180);
  return {subject:`${type}: ${title}`,body:[fileLine,statLine].filter(Boolean).join('\n')};
}
