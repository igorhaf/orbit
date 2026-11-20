import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
/** Shared pure JS is also consumed by the development CLI. Runtime distributions
 * resolve the asset beside dist, or in the approved src layout like Python helpers. */
const asset=[resolve(__dirname,'knowledge-lexical.js'),resolve(__dirname,'../../src/execution/knowledge-lexical.js')].find(existsSync);
if(!asset)throw new Error('Shared lexical engine asset is unavailable.');
const engine=createRequire(__filename)(asset) as typeof import('./knowledge-lexical');
export const lexicalWords=engine.lexicalWords;
export type LexicalDocument={id:string;text:string;label?:string;tokens?:string[];[key:string]:unknown};
export type LexicalRankedDocument<T extends LexicalDocument>={document:T;score:number;matchedTerms:string[]};
export function rankLexical<T extends LexicalDocument>(query:string,documents:T[],options:{tieBreak?:(left:T,right:T)=>number}={}):LexicalRankedDocument<T>[] {
 return engine.rankLexical(query,documents,options) as LexicalRankedDocument<T>[];
}
export const chunkLexical=engine.chunkLexical;
export const lexicalAlgorithm=engine.lexicalAlgorithm;
export const lexicalChunkAlgorithm=engine.lexicalChunkAlgorithm;
