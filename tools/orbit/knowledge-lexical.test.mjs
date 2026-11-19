import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import lexical from '../../packages/orbit-core/src/execution/knowledge-lexical.js';
const {lexicalWords,rankLexical,chunkLexical,lexicalAlgorithm,lexicalChunkAlgorithm}=lexical;
const hash=text=>createHash('sha256').update(text).digest('hex');

test('R2 lexical normalization is Portuguese/accent/case deterministic and not semantic inference',()=>{
 assert.deepEqual(lexicalWords('AÇÃO Ação ação órgão ÓRGÃO ñ X 7 77 foo_bar foo-bar'),['acao','acao','acao','orgao','orgao','77','foo_bar','foo-bar']);
 assert.equal(lexicalAlgorithm,'orbit-bm25-lexical/1');
 assert.deepEqual(rankLexical('matrícula',[{id:'a',text:'inscrição de estudante'}]),[]);
});

test('R1/R3 shared BM25 reproduces the original CLI formula and six-decimal scores',()=>{
 const documents=[{id:'a',label:'docs/contratos.md',text:'permissões plugin dependências dependências'},{id:'b',label:'src/plugin.ts',text:'plugin plugin permissões'},{id:'c',label:'docs/curso.md',text:'matrícula curso aula'},{id:'d',text:''}];
 const query='plugin permissões plugin',terms=[...new Set(lexicalWords(query))],tokens=documents.map(d=>lexicalWords(d.label===undefined?d.text:`${d.label} ${d.text}`));
 const average=tokens.reduce((sum,t)=>sum+t.length,0)/tokens.length;
 const expected=documents.map((document,index)=>{let score=0;for(const term of terms){const df=tokens.filter(t=>t.includes(term)).length,f=tokens[index].filter(t=>t===term).length;score+=Math.log(1+(documents.length-df+0.5)/(df+0.5))*f*2.2/(f+1.2*(0.25+0.75*tokens[index].length/(average||1)));}return {document,score:Math.round(score*1e6)/1e6};}).filter(d=>d.score>0).sort((a,b)=>b.score-a.score||(a.document.id<b.document.id?-1:1));
 assert.deepEqual(rankLexical(query,documents).map(({document,score})=>({document,score})),expected);
 assert.ok(rankLexical('matrícula',documents)[0].document.id==='c');
});

test('R1/R4/R5 same corpus gives stable ties independent of order and no invented matches',()=>{
 const docs=[{id:'z',text:'cuidado cuidado'},{id:'a',text:'cuidado cuidado'},{id:'b',text:'curso inscrição'}];
 assert.deepEqual(rankLexical('cuidado',docs).map(d=>d.document.id),['a','z']);
 assert.deepEqual(rankLexical('cuidado',[...docs].reverse()).map(d=>({id:d.document.id,score:d.score})),rankLexical('cuidado',docs).map(d=>({id:d.document.id,score:d.score})));
 assert.deepEqual(rankLexical('veterinária',docs),[]);assert.deepEqual(rankLexical(' ',docs),[]);assert.deepEqual(rankLexical('cuidado',[]),[]);
});

test('R1 token-only cached vectors produce the same ranking without caching bodies',()=>{
 const docs=[{id:'a',label:'Acolhimento',text:'escuta e acolhimento'},{id:'b',label:'Matrícula',text:'matrícula anual'}];
 const cached=docs.map(d=>({id:d.id,tokens:lexicalWords(`${d.label} ${d.text}`)}));
 assert.deepEqual(rankLexical('acolhimento',docs).map(d=>({id:d.document.id,score:d.score,matched:d.matchedTerms})),rankLexical('acolhimento',cached).map(d=>({id:d.document.id,score:d.score,matched:d.matchedTerms})));
});

test('R6 structural chunks preserve paragraphs, headings, fenced blocks and precise origin slices',()=>{
 const source='# Cuidado\n\nPrimeiro parágrafo\ncontinua aqui.\n\n```ts\nconst rule = "não corte";\n\nconst value = 2;\n```\n\nOutro parágrafo.';
 const result=chunkLexical(source,{maxBytes:256});assert.equal(result.algorithm,lexicalChunkAlgorithm);assert.equal(result.chunks.length,4);assert.equal(result.omissions.length,0);
 for(const c of result.chunks)assert.equal(source.slice(c.startOffset,c.endOffset),c.text);
 const code=result.chunks.find(c=>c.kind==='code');assert.equal(code.startLine,6);assert.equal(code.endLine,10);assert.match(code.text,/const rule[\s\S]*const value/);assert.equal(code.heading,'# Cuidado');
 assert.deepEqual(chunkLexical(source,{maxBytes:256}),result);
});

test('R6 oversized paragraph/fence is omitted whole rather than cut and chunk caps explain omission',()=>{
 const fence='~~~md\n'+('corpo longo '.repeat(100))+'\n~~~';const paragraph='texto '.repeat(100);
 const source='# Título\n\n'+fence+'\n\n'+paragraph+'\n\ncurto';const r=chunkLexical(source,{maxBytes:256,maxChunks:1});
 assert.equal(r.chunks.length,1);assert.deepEqual(r.omissions.map(o=>o.reason),['oversized_block','oversized_block','chunk_limit']);
 assert.equal(r.omissions[0].kind,'code');assert.ok(!JSON.stringify(r.omissions).includes('corpo longo'));assert.equal(r.chunks[0].text,'# Título');
 const unclosed=chunkLexical('```\n'+paragraph,{maxBytes:256});assert.equal(unclosed.chunks.length,0);assert.equal(unclosed.omissions.length,1);
});

test('R6 Unicode and CRLF excerpts retain original bytes and deterministic content hashes',()=>{
 const source='# Órgão\r\n\r\nAção 😀 em português.\r\n';const a=chunkLexical(source),b=chunkLexical(source);
 assert.deepEqual(a,b);for(const c of a.chunks){assert.equal(source.slice(c.startOffset,c.endOffset),c.text);assert.equal(hash(c.text),hash(b.chunks.find(v=>v.startOffset===c.startOffset).text));}
 assert.equal(a.chunks[1].startLine,3);assert.ok(a.chunks[1].text.endsWith('\r'));
});

test('pure engine does not mutate input and rejects malformed vectors, ids and limits',()=>{
 const docs=[{id:'a',tokens:['acao','curso']}],before=structuredClone(docs);rankLexical('ação',docs);assert.deepEqual(docs,before);
 assert.throws(()=>rankLexical('x',[{id:'a',tokens:[42]}]),/vectors/);assert.throws(()=>rankLexical('xx',[{id:'a',text:'a'},{id:'a',text:'b'}]),/unique/);
 assert.throws(()=>chunkLexical('body',{maxBytes:1}),/limits/);assert.throws(()=>chunkLexical('body',{maxChunks:0}),/limits/);
});
