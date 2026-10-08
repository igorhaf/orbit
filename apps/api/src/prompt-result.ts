export type PromptCommitMetadata={type:string|null;name:string|null;summary:string|null};
export type PromptSummaryResult={summary:string|null;output:string;commit:PromptCommitMetadata};

const marker=(name:string)=>new RegExp(`\\[\\[${name}\\]\\]\\s*([\\s\\S]*?)(?=\\n?\\[\\[ORBIT_[A-Z_]+\\]\\]|$)`,'i');

export function extractPromptSummary(output:string,maxLines:number|null=10):PromptSummaryResult{
  const match=output.match(/\[\[ORBIT_SUMMARY\]\]\s*([\s\S]*?)\s*\[\[\/ORBIT_SUMMARY\]\]/i);
  if(!match)return {summary:null,output,commit:{type:null,name:null,summary:null}};
  const block=match[1];
  const extract=(name:string)=>block.match(marker(name))?.[1]?.trim()||null;
  const rawType=extract('ORBIT_COMMIT_TYPE')?.split(/\r?\n/,1)[0]?.trim().toLowerCase()||null;
  const type=rawType&&/^[a-z][a-z0-9-]{0,29}$/.test(rawType)?rawType:null;
  const clean=(value:string|null,limit:number)=>value?.replace(/\r\n?/g,'\n').split('\n').map(line=>line.trim()).filter(Boolean).slice(0,limit).join('\n').slice(0,limit===1?100:360)||null;
  const name=clean(extract('ORBIT_NAME'),1);
  const summary=clean(extract('ORBIT_COMMIT_SUMMARY'),1);
  const humanBlock=block.replace(/\[\[ORBIT_(?:COMMIT_TYPE|NAME|COMMIT_SUMMARY)\]\][\s\S]*?(?=\n?\[\[ORBIT_(?:COMMIT_TYPE|NAME|COMMIT_SUMMARY)\]\]|$)/gi,'').trim();
  const lines=humanBlock.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const humanSummary=(maxLines===null?lines:lines.slice(0,maxLines)).join('\n').slice(0,maxLines===null?undefined:3000)||null;
  return {summary:humanSummary,output:output.replace(match[0],'').trimEnd(),commit:{type,name,summary}};
}
