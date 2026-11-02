import {spawn} from 'node:child_process';
export function applyReversePatch(root:string,diff:string,check=false):Promise<void>{
 if(!diff.trim()||diff.length>2_000_000)throw new Error('Patch vazio ou muito grande.');
 return new Promise((resolve,reject)=>{const child=spawn('git',['apply','--reverse',...(check?['--check']:[]),'-'],{cwd:root,stdio:['pipe','ignore','pipe']});let detail='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Tempo limite ao reverter alterações.'))},10_000);child.stderr.on('data',chunk=>detail+=String(chunk).slice(0,2000));child.on('error',error=>{clearTimeout(timer);reject(error)});child.on('exit',code=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error(`Não foi possível desfazer sem conflito. Os arquivos foram preservados. ${detail.slice(0,1000)}`))});child.stdin.on('error',()=>undefined);child.stdin.end(diff)})
}
