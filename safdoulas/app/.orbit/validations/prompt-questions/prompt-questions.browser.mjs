import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const mockApi=`
export const getToken=()=>null;
export async function api(path,options){
  const state=window.fixture;
  if(path.endsWith('/answer')){
    const body=JSON.parse(options.body);state.answers.push(body.answer);
    if(state.failAnswer)throw new Error('Não foi possível enviar a resposta.');
    state.run.status='queued';state.run.output=null;return {id:state.run.id,status:'queued'};
  }
  if(path.endsWith('/cancel')){state.run.status='cancelled';return {};}
  if(path.endsWith('/prompt-runs'))return [{...state.run}];
  if(path==='/ai/models')return [{id:'gpt-6-luna',name:'Luna',version:'GPT-6'}];
  if(path==='/ai/execution-projects')return [];
  return {};
}
export async function send(path,method,body){window.fixture.settings.push(body);return {};}
`;
const bundle=await build({stdin:{contents:`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CardAi} from './apps/web/components/card-ai';
import {PromptExecution} from './apps/web/components/prompt-execution';
import {CardActivityIndicator} from './apps/web/components/card-execution';
const card={id:'card',title:'Demand',description:'',list_id:'list',ai_execution_mode:'question',prompt:{status:'waiting_answer'}};
const board={id:'board',title:'Orbit reference',lists:[]};
const noop=async()=>{};
createRoot(document.getElementById('root')).render(<><CardAi card={card} board={board} onApply={noop} onChanged={noop}/><CardActivityIndicator card={card}/><PromptExecution card={card} board={board} active={true}/></>);
`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture',setup(builder){
 builder.onResolve({filter:/^@\/lib\/api$/},()=>({path:'api',namespace:'fixture'}));
 builder.onResolve({filter:/^socket.io-client$/},()=>({path:'socket',namespace:'fixture'}));
 builder.onResolve({filter:/^next\/image$/},()=>({path:'image',namespace:'fixture'}));
 builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='api'?mockApi:args.path==='socket'?`export const io=()=>({on(){},emit(){},disconnect(){}});`:`import React from 'react';export default function Image(props){return React.createElement('img',props);}`,loader:'js',resolveDir:root}));
}}]});
const cssDir=resolve(root,'apps/web',process.env.ORBIT_NEXT_DIST_DIR||'.next','static/css');
let css='';for(const file of await readdir(cssDir))if(file.endsWith('.css'))css+=await readFile(resolve(cssDir,file),'utf8');
assert.ok(css,'Build the web workspace before measuring layout.');
for(const width of [1280,390]){
 const browser=await chromium.launch({headless:true,...(process.env.ORBIT_TEST_CHROME_BIN?{executablePath:resolve(process.env.ORBIT_TEST_CHROME_BIN)}:{}),args:['--no-sandbox',...(process.env.ORBIT_TEST_CHROME_BIN?['--no-zygote','--single-process']:[])]});
 try{
  const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<500});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://orbit.test/**',route=>route.fulfill({contentType:'text/html',body:'<html><head></head><body><main id="root" style="max-width:800px;margin:auto"></main></body></html>'}));
  await page.goto('https://orbit.test/');
  await page.addStyleTag({content:css});
  await page.evaluate(()=>{window.fixture={settings:[],answers:[],failAnswer:true,run:{id:'run',model:'gpt-6-luna',effort:'high',status:'waiting_answer',output:'Posso seguir com a implementação?',started_at:new Date().toISOString(),prompt:'[[ORBIT_SUMMARY]]'}};});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const mode=page.getByRole('combobox',{name:'Modo de execução da IA'});
  assert.deepEqual(await mode.locator('option').allTextContents(),['Planejamento','Permissivo','Questionar']);
  await mode.selectOption('question');
  assert.deepEqual(await page.evaluate(()=>window.fixture.settings),[{ai_execution_mode:'question'}]);
  await page.getByLabel('Fila de perguntas · Sua resposta').fill('Sim, pode seguir.');
  await page.getByRole('button',{name:'Responder e voltar à fila'}).click();
  await page.getByRole('alert').filter({hasText:'Não foi possível enviar a resposta.'}).waitFor();
  assert.equal(await page.getByLabel('Fila de perguntas · Sua resposta').inputValue(),'Sim, pode seguir.');
  await page.evaluate(()=>{window.fixture.failAnswer=false;});
  await page.getByRole('button',{name:'Responder e voltar à fila'}).click();
  await page.getByLabel('Fila de perguntas · Sua resposta').waitFor({state:'detached'});
  assert.deepEqual(await page.evaluate(()=>window.fixture.answers),['Sim, pode seguir.','Sim, pode seguir.']);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  assert.equal(overflow,false,`overflow at ${width}px`);
  assert.deepEqual(errors,[]);
  console.log(`PASS ${width}px: modos, pergunta, erro recuperável, resposta e retorno à fila`);
  await page.close();
 }finally{await browser.close();}
}
