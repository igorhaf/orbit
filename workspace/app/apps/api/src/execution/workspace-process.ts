import {spawn,ChildProcess,SpawnOptions,StdioOptions} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {currentWorkspaceWriteLease} from './workspace-coordinator';

/** The caller must await lease.assertActive() immediately before spawning. */
export function spawnWorkspaceProcess(file:string,args:readonly string[],options:SpawnOptions={}):ChildProcess {
  const lease=currentWorkspaceWriteLease();
  if(!lease)return spawn(file,[...args],options);
  if(lease.signal.aborted)throw new Error('Workspace write lease is no longer active.');
  const descriptors=lease.descriptors();
  if(!descriptors.length)throw new Error('Workspace write lease has no process guards.');
  if(options.shell)throw new Error('Workspace processes require an argv command without shell.');
  const configured=options.stdio??'pipe';
  if(Array.isArray(configured)&&configured.length>3)throw new Error('Workspace process descriptors above stderr are reserved for write guards.');
  const streams=Array.isArray(configured)?[configured[0]??'pipe',configured[1]??'pipe',configured[2]??'pipe']:[configured,configured,configured];
  const script=[resolve(__dirname,'workspace-supervisor.py'),resolve(__dirname,'../../src/execution/workspace-supervisor.py')].find(existsSync);
  if(!script)throw new Error('Workspace process supervisor is unavailable.');
  const child=spawn('python3',['-I','-B',script,'--fd-count',String(descriptors.length),'--parent',String(process.pid),'--',file,...args],{
    ...options,shell:false,env:{...(options.env??process.env),ORBIT_WORKSPACE_SUPERVISOR_PARENT_PID:String(process.pid)},
    stdio:[...streams,...descriptors] as StdioOptions,
  });
  lease.trackProcess(child);
  return child;
}
