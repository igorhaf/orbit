import {chmod,lstat,mkdir,readFile,readdir,readlink,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';

type Entry={kind:'file';body:Buffer;mode:number}|{kind:'link';target:string};
const generated=new Set(['node_modules','.git','.next','.next-dev','.next-build','.next-validation','dist','build']);
export function validateWriteScope(value:unknown):string[]{
  if(!Array.isArray(value)||value.length>100||value.some(path=>typeof path!=='string'||!path||path.length>1000||isAbsolute(path)||path.includes('\\')||path.split('/').some(part=>!part||part==='.'||part==='..'||generated.has(part))||/(^|\/)(\.env(?:\..*)?|\.ssh|\.codex|credentials(?:\..*)?|auth\.json)(\/|$)/i.test(path)))throw new Error('Escopo de escrita inválido. Informe arquivos relativos e não reservados.');
  return [...new Set(value)] as string[];
}

// Compare the working tree, not just CLI events: shell writes must be checked too.
export async function captureFileScope(root:string,allowed:string[]){
  const scope=new Set(validateWriteScope(allowed));
  for(const path of scope){
    const parts=path.split('/');
    for(let index=0;index<parts.length;index++){
      let entry;
      try{entry=await lstat(join(root,...parts.slice(0,index+1)))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')break;throw error}
      if(entry.isSymbolicLink()||(index===parts.length-1&&entry.isDirectory()))throw new Error(`Escopo de escrita inválido: informe arquivos sem links simbólicos: ${path}.`);
    }
  }
  async function snapshot(){
    const files=new Map<string,Entry>();let bytes=0;
    async function walk(directory:string){
      for(const entry of await readdir(directory,{withFileTypes:true})){
        if(entry.isDirectory()&&generated.has(entry.name)||entry.name.endsWith('.tsbuildinfo')||entry.name==='next-env.d.ts')continue;
        const path=join(directory,entry.name),key=relative(root,path).split('\\').join('/');
        if(key==='.orbit/validations/artifacts')continue;
        if(entry.isDirectory())await walk(path);
        else if(entry.isSymbolicLink())files.set(key,{kind:'link',target:await readlink(path)});
        else if(entry.isFile()){const body=await readFile(path);bytes+=body.length;if(bytes>100*1024*1024)throw new Error('Projeto excede 100 MB para verificação de escopo; exclua apenas diretórios de build ou dependências.');files.set(key,{kind:'file',body,mode:(await stat(path)).mode})}
      }
    }
    await walk(root);return files;
  }
  const before=await snapshot();
  async function changes(){
    const after=await snapshot();
    const changed=[...new Set([...before.keys(),...after.keys()])].filter(path=>{
      const a=before.get(path),b=after.get(path);
      return !a||!b||a.kind!==b.kind||(a.kind==='file'&&b.kind==='file'?a.mode!==b.mode||!a.body.equals(b.body):a.kind==='link'&&b.kind==='link'&&a.target!==b.target);
    });
    return changed;
  }
  async function restore(paths:string[]){
    // Remove replaced parent links before restoring children; never follow them.
    for(const path of [...paths].sort((a,b)=>a.split('/').length-b.split('/').length)){
      const absolute=resolve(root,path),previous=before.get(path);
      await rm(absolute,{force:true,recursive:true});
      if(previous){await mkdir(dirname(absolute),{recursive:true});if(previous.kind==='file'){await writeFile(absolute,previous.body,{mode:previous.mode});await chmod(absolute,previous.mode&0o7777)}else await symlink(previous.target,absolute)}
    }
  }
  const verify=async()=>{
    const changed=await changes(),unexpected=changed.filter(path=>!scope.has(path));
    if(!unexpected.length)return changed;
    await restore(unexpected);
    throw new Error(`Alterações fora do escopo foram revertidas: ${unexpected.join(', ')}. A demanda precisa ser corrigida antes de concluir.`);
  };
  return Object.assign(verify,{rollback:async()=>{const changed=await changes();await restore(changed);return changed}});
}
