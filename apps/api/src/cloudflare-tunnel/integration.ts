import {CloudflaredAdapter} from './cloudflared-adapter';
import {defaults} from './configuration';
import {CloudflaredProcessManager} from './process-manager';
async function main(){
 if(process.env.ORBIT_CLOUDFLARE_INTEGRATION!=='1')throw new Error('Teste real exige ORBIT_CLOUDFLARE_INTEGRATION=1.');
 const adapter=new CloudflaredAdapter();const detection=await adapter.detect(process.env.ORBIT_CLOUDFLARE_BINARY||'auto');
 if(!detection.installed)throw new Error('cloudflared não encontrado.');
 console.log(`cloudflared detectado: ${detection.version}`);
 if(process.env.ORBIT_CLOUDFLARE_CONFIG){await adapter.validate({...defaults,mode:'local',configPath:process.env.ORBIT_CLOUDFLARE_CONFIG},'',detection);console.log('YAML e ingress válidos.');}
 if(process.env.ORBIT_CLOUDFLARE_QUICK_URL){
 const manager=new CloudflaredProcessManager(adapter);
 try{await manager.initialize(true,{...defaults,executablePath:detection.path!,mode:'quick',quickUrl:process.env.ORBIT_CLOUDFLARE_QUICK_URL,restartOnFailure:false},'',null);await manager.start();
 for(let attempt=0;attempt<20;attempt++){await new Promise(resolve=>setTimeout(resolve,1000));await manager.tick();if(manager.snapshot().state==='CONNECTED'){console.log('Quick Tunnel conectado.');return;}}
 throw new Error('Quick Tunnel não confirmou conexão no prazo.');
 }finally{await manager.shutdown();console.log('Processo próprio encerrado.');}
 }
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Integração falhou.');process.exitCode=1;});
