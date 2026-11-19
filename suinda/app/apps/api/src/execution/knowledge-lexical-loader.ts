import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
/** Shared pure JS is also consumed by the development CLI. Runtime distributions
 * resolve the asset beside dist, or in the approved src layout like Python helpers. */
const asset=[resolve(__dirname,'knowledge-lexical.js'),resolve(__dirname,'../../src/execution/knowledge-lexical.js')].find(existsSync);
if(!asset)throw new Error('Shared lexical engine asset is unavailable.');
const engine=require(asset) as typeof import('./knowledge-lexical');
export const {lexicalWords,rankLexical,chunkLexical,lexicalAlgorithm,lexicalChunkAlgorithm}=engine;
