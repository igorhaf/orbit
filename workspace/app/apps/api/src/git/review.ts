export type ReviewSection = { kind:'equal'|'change'; left:string[]; right:string[] };

const lines=(text:string)=>text.match(/[^\n]*\n|[^\n]+$/g)||[];

export function compareText(left:string,right:string):{sections:ReviewSection[];tooLarge:boolean}{
  const a=lines(left),b=lines(right);
  if(left.length>120_000||right.length>120_000||a.length>1500||b.length>1500)return {sections:[],tooLarge:true};
  const width=b.length+1,table=Array.from({length:a.length+1},()=>new Uint16Array(width));
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)table[i][j]=a[i]===b[j]?table[i+1][j+1]+1:Math.max(table[i+1][j],table[i][j+1]);
  const sections:ReviewSection[]=[];let i=0,j=0;
  const append=(kind:'equal'|'change',side:'left'|'right',line:string)=>{let section=sections.at(-1);if(!section||section.kind!==kind){section={kind,left:[],right:[]};sections.push(section)}section[side].push(line)};
  while(i<a.length||j<b.length){
    if(i<a.length&&j<b.length&&a[i]===b[j]){append('equal','left',a[i]);append('equal','right',b[j]);i++;j++;}
    else if(i<a.length&&(j===b.length||table[i+1][j]>=table[i][j+1])){append('change','left',a[i]);i++;}
    else {append('change','right',b[j]);j++;}
  }
  return {sections,tooLarge:false};
}

export function mergeText(sections:ReviewSection[],choices:boolean[]):string{
  if(sections.filter(section=>section.kind==='change').length!==choices.length)throw new Error('Seleção dos trechos inválida.');
  let change=0;
  return sections.map(section=>section.kind==='equal'?section.left.join(''):(choices[change++]?section.right:section.left).join('')).join('');
}
