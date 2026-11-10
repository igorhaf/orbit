import dotenv from 'dotenv';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
import {mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const allowLocalOnly=process.argv.includes('--allow-dev-local-only-backup');
dotenv.config({path:resolve(root,'apps/api/.env'),quiet:true});
if(!process.env.DATABASE_URL)throw new Error('apps/api/.env precisa configurar DATABASE_URL para o banco DEV.');
const target=new URL(process.env.DATABASE_URL);
const dbName=decodeURIComponent(target.pathname.replace(/^\//,''));
const container='orbit-db-dev';
const address=execFileSync('docker',['inspect','-f','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',container],{encoding:'utf8'}).trim();
if(!address)throw new Error('Não foi possível obter o endereço da instância PostgreSQL orbit-db-dev.');
target.hostname=address;
const check=new pg.Pool({connectionString:target.toString(),connectionTimeoutMillis:5000,max:1});
try{
 const result=await check.query('SELECT current_database() AS name');
 if(result.rows[0]?.name!==dbName)throw new Error('Migração recusada: a conexão não corresponde ao banco configurado em apps/api/.env.');
}finally{await check.end()}
process.env.DATABASE_URL=target.toString();
process.env.ORBIT_ENV='development';
const backupDir=resolve(homedir(),'.local/share/orbit-dev-migration-backups');
await mkdir(backupDir,{recursive:true,mode:0o700});
process.env.ORBIT_BACKUP_DIR=backupDir;
if(allowLocalOnly)console.warn('Executando migração DEV com verificação obrigatória do backup local; sem exigir cópia Drive.');
const args=['run','db:migrate','-w','apps/api','--',...(allowLocalOnly?['--allow-dev-local-only-backup']:[])];
const result=spawnSync('npm',args,{cwd:root,stdio:'inherit',env:process.env});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status??1);
