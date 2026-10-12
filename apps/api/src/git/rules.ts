export const gitTypes=['feat','fix','chore','docs','style','refactor','perf','test','build','ci','revert'] as const;
export type GitType=string;
export function validCommitType(input:unknown):input is string{return typeof input==='string'&&/^[a-z][a-z0-9-]{0,29}$/.test(input);}
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
    if(typeof path!=='string'||path.length>1000||!path||path.startsWith('-')||path.startsWith('/')||path.includes('\\')||[...path].some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127)||[':','*','?','[',']'].some(char=>path.includes(char))||path.split('/').some(part=>!part||part==='.'||part==='..'||part==='.git'||part==='.env'||part.startsWith('.env.')))throw new Error('Caminho de arquivo inválido.');
    return path;
  });
  return [...new Set(paths)];
}
export function conventionalMessage(type:unknown,subject:unknown,files:string[],shortstat:string){
  if(!validCommitType(type))throw new Error('Tipo de commit inválido.');
  if(typeof subject!=='string'||!subject.trim())throw new Error('Título do commit obrigatório.');
  const title=subject.trim().replace(/\s+/g,' ').replace(/^[a-z][a-z0-9-]*(?:\([^)]+\))?!?:\s*/i,'').slice(0,100);
  const fileLine=`Arquivos: ${files.slice(0,6).join(', ')}${files.length>6?` e mais ${files.length-6}`:''}`.slice(0,180);
  const statLine=shortstat.trim().replace(/\s+/g,' ').slice(0,180);
  return {subject:`${type}: ${title}`,body:[fileLine,statLine].filter(Boolean).join('\n')};
}

export function commitSuggestion(title:string,summary:string|null,files:Array<{path:string;status:string}>){
  const clean=(value:string)=>value.split('\n').map(line=>line.replace(/^\s*(?:[-*#>]+\s*)?/,'').replace(/[*_`]/g,'').replace(/^(?:resumo|summary|alterações|o que mudou|resultado)\s*:\s*/i,'').trim()).find(line=>line&&!/^(?:resumo|summary|alterações|o que mudou|resultado)\s*:?$/i.test(line))||'';
  const subject=(clean(summary||'')||clean(title)||'Atualizar projeto').replace(/\s+/g,' ').replace(/[.!?]$/,'').slice(0,100);
  const words=`${title} ${subject}`.toLowerCase();
  const type:GitType=/\b(fix|bug|erro|falha|corrig|consert|repar)/.test(words)?'fix':/\b(chore|refator|document|configur|depend|manuten|limpez)/.test(words)?'chore':'feat';
  const names=files.map(file=>file.path);
  const fileLine=`Arquivos: ${names.slice(0,6).join(', ')}${names.length>6?` e mais ${names.length-6}`:''}`.slice(0,180);
  const added=files.filter(file=>file.status==='added').length,removed=files.filter(file=>file.status==='deleted').length,changed=files.length-added-removed;
  const changes=[added&&`${added} novo${added===1?'':'s'}`,changed&&`${changed} alterado${changed===1?'':'s'}`,removed&&`${removed} removido${removed===1?'':'s'}`].filter(Boolean).join(', ');
  return {type,subject,description:[fileLine,`Mudanças: ${changes}`].filter(Boolean).join('\n')};
}

export function commitDescription(input:unknown,fallback:string){
  if(input===undefined)return fallback;
  if(typeof input!=='string')throw new Error('Descrição do commit inválida.');
  const lines=input.replace(/\r\n?/g,'\n').trim().split('\n');
  if(lines.length>2||lines.some(line=>line.length>180||[...line].some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127)))throw new Error('A descrição do commit deve ter no máximo duas linhas de 180 caracteres.');
  return lines.join('\n');
}
