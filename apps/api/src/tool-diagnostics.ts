import {redact} from './execution/security';

export type ToolCommandActivity={command:string;output:string;status:'running'|'completed'|'failed';exitCode?:number};
export type ToolRunInput={status:string;error?:string|null;activities?:ToolCommandActivity[]|null};
export type ToolProblem={kind:'missing'|'permission'|'command'|'authentication'|'version';tool:string;title:string;details:string;installCommands:string[];failedCommand:string|null};

const installCommands:Record<string,string[]>={
  docker:['Linux (Debian/Ubuntu): sudo apt-get update && sudo apt-get install -y docker.io','macOS: brew install --cask docker','Windows: winget install Docker.DockerDesktop'],
  codex:['npm: npm install -g @openai/codex@latest','Homebrew: brew update && brew upgrade --cask codex','Depois da instalação, confirme com: codex --version'],
  git:['Linux (Debian/Ubuntu): sudo apt-get update && sudo apt-get install -y git','macOS: brew install git','Windows: winget install Git.Git'],
  node:['Linux (Debian/Ubuntu): sudo apt-get update && sudo apt-get install -y nodejs npm','macOS: brew install node','Windows: winget install OpenJS.NodeJS.LTS'],
  npm:['Instale o Node.js, que inclui o npm. Linux: sudo apt-get update && sudo apt-get install -y nodejs npm','macOS: brew install node','Windows: winget install OpenJS.NodeJS.LTS'],
  python:['Linux (Debian/Ubuntu): sudo apt-get update && sudo apt-get install -y python3','macOS: brew install python','Windows: winget install Python.Python.3.12'],
  python3:['Linux (Debian/Ubuntu): sudo apt-get update && sudo apt-get install -y python3','macOS: brew install python','Windows: winget install Python.Python.3.12'],
  bun:['npm: npm install -g bun','macOS: brew install oven-sh/bun/bun'],
  ps:['Linux (Debian/Ubuntu): sudo apt-get update && sudo apt-get install -y procps','macOS: comando ps já vem no sistema','Windows: use Get-Process no PowerShell'],
  psql:['Linux (Debian/Ubuntu): sudo apt-get update && sudo apt-get install -y postgresql-client','macOS: brew install libpq','Windows: winget install PostgreSQL.PostgreSQL'],
  sqlite3:['Linux (Debian/Ubuntu): sudo apt-get update && sudo apt-get install -y sqlite3','macOS: brew install sqlite','Windows: winget install SQLite.SQLite'],
  rg:['Linux (Debian/Ubuntu): sudo apt-get update && sudo apt-get install -y ripgrep','macOS: brew install ripgrep','Windows: winget install BurntSushi.ripgrep.MSVC'],
};

function commandTool(command:string){
  const checked=command.match(/\bcommand\s+-v\s+([\w.+-]+)/i)?.[1];
  const executable=checked||command.match(/(?:^|[;&|]\s*)(?:sudo\s+)?([\w./+-]+)/)?.[1]||'';
  return executable.split('/').pop()?.replace(/\.cmd$/i,'').toLowerCase()||'ferramenta';
}

export function diagnoseToolFailures(run:ToolRunInput):ToolProblem[]{
  if(run.status!=='error')return [];
  const issues:ToolProblem[]=[];
  const add=(problem:ToolProblem)=>{if(!issues.some(issue=>issue.kind===problem.kind&&issue.tool===problem.tool&&issue.failedCommand===problem.failedCommand))issues.push(problem)};
  const missing=(tool:string,command:string|null)=>{
    const known=installCommands[tool];
    add({kind:'missing',tool,title:`Ferramenta ausente: ${tool}`,details:known?'Instale a ferramenta no mesmo ambiente que executa o prompt e tente novamente.':'A ferramenta não foi encontrada no ambiente de execução. Peça ao administrador para instalá-la ou informar o caminho do executável.',installCommands:known||[],failedCommand:command});
  };
  const permission=(tool:string,command:string|null)=>add({kind:'permission',tool,title:`Permissão insuficiente ao usar ${tool}`,details:'Confira qual usuário executa o Orbit e conceda somente a permissão necessária ao executável ou caminho indicado. Evite permissões recursivas.',installCommands:[],failedCommand:command});
  const failedActivities=run.activities?.filter(activity=>activity.status==='failed')||[];
  const missingPattern=/command not found|not recognized as an internal or external command|spawn\s+[^\n]*\bENOENT\b|executable[^\n]*(?:not found|não foi encontrado)|could not start[^\n]*(?:command|executable)|cannot find (?:the )?(?:command|executable)/i;
  const permissionPattern=/permission denied|access is denied|\bEACCES\b|\bEPERM\b|operation not permitted|permissão negada|sem permissão/i;
  const commandCheck=/\bcommand\s+-v\s+([\w.+-]+)/gi;
  const missingExecutable=(output:string)=>{
    const patterns=[
      /(?:^|\n)(?:[^\s:\n]+\/)?(?:bash|sh):\s*(?:line\s+\d+:\s*)?([^\s:]+):\s*(?:command not found|not found)\b/i,
      /(?:^|\n)([\w.+/-]+):\s*command not found\b/i,
      /spawn\s+([^\s]+)\s+ENOENT\b/i,
    ];
    for(const pattern of patterns){const match=output.match(pattern);if(match)return match[1].split('/').pop()?.replace(/\.cmd$/i,'').toLowerCase()||null;}
    return null;
  };
  for(const activity of failedActivities){
    const command=redact(activity.command).slice(0,1000);
    const evidence=redact(activity.output);
    const checked=[...activity.command.matchAll(commandCheck)].map(match=>match[1].toLowerCase());
    if(checked.length&&(activity.exitCode??0)!==0){
      const outputLines=activity.output.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
      for(const tool of new Set(checked))if(!outputLines.some(line=>line.split(/[\\/]/).pop()?.replace(/\.cmd$/i,'').toLowerCase()===tool))missing(tool,command);
      continue;
    }
    const executable=missingExecutable(evidence);
    if(executable){
      missing(executable,command);
      continue;
    }
    if(activity.exitCode===127&&missingPattern.test(evidence))continue;
    if(permissionPattern.test(evidence)||activity.exitCode===126){permission(commandTool(activity.command),command);continue;}
    const inlineScript=/(?:^|\s)(?:node|python3?|bash|sh|zsh)(?:\s+(?:-e|-c)|[^\n]*<<)/i.test(activity.command);
    if(inlineScript&&/syntax error near unexpected token|unexpected end of file|here-document .* delimited by end-of-file|SyntaxError:|missing \) after argument list|unterminated (?:string|here-document)/i.test(evidence)){
      add({kind:'command',tool:commandTool(activity.command),title:'Comando ou script com sintaxe inválida',details:'Revise as aspas e os delimitadores do comando/script. Não é necessário instalar uma ferramenta; depois, abra o cartão e execute o prompt novamente.',installCommands:[],failedCommand:command});
    }
  }
  const runError=redact(run.error||'');
  const latestCommand=failedActivities.at(-1)?redact(failedActivities.at(-1)!.command).slice(0,1000):null;
  if(/not logged in|not authenticated|authentication required|unauthorized|invalid api key|login required|não está autenticado|não autenticado/i.test(runError)){
    add({kind:'authentication',tool:'codex',title:'Codex CLI sem autenticação',details:'Entre na conta do Codex no mesmo ambiente que executa a API e tente o prompt novamente.',installCommands:['codex login'],failedCommand:latestCommand});
  }else if(/unknown (?:argument|option|flag)|unrecognized (?:argument|option|flag)|usage: codex|versão instalada do codex|opções usadas pelo orbit/i.test(runError)){
    add({kind:'version',tool:'codex',title:'Codex CLI desatualizado ou incompatível',details:'Atualize o Codex CLI no ambiente de execução e tente novamente.',installCommands:installCommands.codex,failedCommand:latestCommand});
  }else{
    if(!issues.some(issue=>issue.kind==='missing')){
      const executable=missingExecutable(runError);
      if(executable)missing(executable,latestCommand);
      else if(/executável local do codex não foi encontrado/i.test(runError))missing('codex',latestCommand);
    }
    if(permissionPattern.test(runError)&&!issues.some(issue=>issue.kind==='permission'))permission(commandTool(failedActivities.at(-1)?.command||''),latestCommand);
  }
  return issues;
}

export function diagnoseToolFailure(run:ToolRunInput):ToolProblem|null{return diagnoseToolFailures(run)[0]||null;}
