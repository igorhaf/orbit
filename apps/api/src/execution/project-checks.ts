import {execFile} from 'node:child_process';
import {redact} from './security';

export function validateProjectChecks(value:unknown):string[][] {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>10||value.some(command=>!Array.isArray(command)||!command.length||command.length>30||command.some(argument=>typeof argument!=='string'||argument.length>2000||argument.includes('\0')||argument.includes('\n'))||!/^[a-zA-Z0-9_.-]+$/.test(command[0])))throw new Error('Verificações do projeto inválidas: use listas de executável e argumentos.');
  return value.map(command=>[...command]);
}

export async function runProjectChecks(root:string,checks:string[][],timeout=90000){
  for(const [executable,...args] of validateProjectChecks(checks))await new Promise<void>((resolve,reject)=>{
    execFile(executable,args,{cwd:root,timeout,maxBuffer:256*1024},(error,stdout,stderr)=>{
      if(error)reject(new Error(`Verificação obrigatória falhou: ${executable} ${args.join(' ')}. ${redact((stderr||stdout||error.message).slice(-2000))}`));
      else resolve();
    });
  });
}
