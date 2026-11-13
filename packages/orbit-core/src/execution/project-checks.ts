import {redact} from './security';
import {runManagedProcess} from './managed-process';

export function validateProjectChecks(value:unknown):string[][] {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>10||value.some(command=>!Array.isArray(command)||!command.length||command.length>30||command.some(argument=>typeof argument!=='string'||argument.length>2000||argument.includes('\0')||argument.includes('\n'))||!/^[a-zA-Z0-9_.-]+$/.test(command[0])))throw new Error('Verificações do projeto inválidas: use listas de executável e argumentos.');
  return value.map(command=>[...command]);
}

export async function runProjectChecks(root:string,checks:string[][],timeout=90000){
  for(const [executable,...args] of validateProjectChecks(checks)){
    try{
      const result=await runManagedProcess(executable,args,{cwd:root,timeoutMs:timeout,maxOutputBytes:256*1024});
      if(result.code!==0)throw new Error(result.stderr||result.stdout||`terminou com código ${result.code}`);
    }catch(error){
      throw new Error(`Verificação obrigatória falhou: ${executable} ${args.join(' ')}. ${redact((error instanceof Error?error.message:String(error)).slice(-2000))}`);
    }
  }
}
