// Optional plugin port; the card domain never invokes a specific AI provider.
export const ORBIT_AI_CARD=Symbol('ORBIT_AI_CARD');
export interface AiCardOperations {
 aiCard(card:string,user:string,body:Record<string,unknown>):Promise<{output:string;items:string[]}>;
 aiComment(card:string,user:string,body:Record<string,unknown>):Promise<{output:string}>;
 aiMerge(user:string,body:Record<string,unknown>):Promise<{title:string;description:string;items:string[]}>;
 aiEmailSummary(user:string,body:Record<string,unknown>,project?:string|null):Promise<{title:string;summary:string;items:string[];due_date:string|null}>;
}
