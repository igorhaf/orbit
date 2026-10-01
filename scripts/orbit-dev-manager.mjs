import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const npm=process.platform==='win32'?'npm.cmd':'npm';
const environment={...process.env,API_PORT:'4001',WEB_ORIGIN:'http://localhost:3001',ORBIT_API_PROXY_URL:'http://127.0.0.1:4001',ORBIT_ENV:'development',THEME:'dark',PORT:'3001'};
console.log('\nOrbit DEV ativo em http://localhost:3001 (API: http://localhost:4001).\n');
const children=[
  spawn(npm,['run','start','-w','apps/api'],{cwd:root,stdio:'inherit',env:environment,detached:process.platform!=='win32'}),
  spawn(npm,['run','start','-w','apps/web'],{cwd:root,stdio:'inherit',env:environment,detached:process.platform!=='win32'}),
];
function stop(){for(const child of children)if(child.pid)try{process.platform==='win32'?child.kill('SIGTERM'):process.kill(-child.pid,'SIGTERM')}catch{child.kill('SIGTERM')}process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
