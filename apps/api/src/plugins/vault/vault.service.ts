import {Inject,Injectable,HttpException} from '@nestjs/common';
import type {Request} from 'express';
import {Db} from '../../db';
import {FeaturesService} from '../../features';
import {PluginRegistry} from '../../execution/registries';
import {decryptVaultPayload,encryptVaultPayload,vaultItemHtml} from '../../vault-crypto';
import {credentials,vaultConstants,assertVaultReferencesRetained,refreshVaultEnvironment} from '../../credential-store';
import {sanitizeNotebookHtml} from '../../notebook-sanitizer';
import {notebookHtmlToMarkdown} from '../../notebook-markdown';
import {id as uuid} from '../../access/access';
type Payload=Record<string,unknown>;
const fail=(message:string,code=400):never=>{throw new HttpException({message},code)};
const value=(v:unknown,name:string,max=300)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)fail(`${name} inválido.`);return (v as string).trim()};
const BUILT_IN_VAULT_CATEGORIES=new Set(['site','api','ssh','bank_test','license','custom']);
const VAULT_CATEGORY_ICONS=new Set(['AtSign','Banknote','BriefcaseBusiness','Cloud','Code2','CreditCard','Database','Fingerprint','Folder','Globe','KeyRound','Laptop','LockKeyhole','Mail','Monitor','Network','Rocket','Shield','Smartphone','Terminal','UserRound','WalletCards','Wifi','Wrench']);
@Injectable()
export class VaultService{
 constructor(@Inject(Db)private db:Db,@Inject(FeaturesService)private features:FeaturesService,@Inject(PluginRegistry)private registry:PluginRegistry){}
 assertEnabled(){if(!this.registry.isEnabled('vault'))throw new HttpException('O Cofre não está disponível nesta instância.',409)}
 user(req:Request){return this.features.user(req)}
 private cardBoard(card:string,user:string){return this.features.cardBoard(card,user)}
 private async listBoard(list:string,user:string){uuid(list);const row=await this.db.one('SELECT board_id,archived_at FROM lists WHERE id=$1',[list]);if(!row)return fail('Lista não encontrada.',404);await this.features.member(row.board_id,user);if(row.archived_at)fail('Esta lista está arquivada.',409);if(this.features.access&&!await this.features.access.boardPermission(row.board_id,user,'boards.write'))fail('Sem permissão para criar cartão no quadro.',403);return row.board_id as string}
  private encryptVault(payload:Payload) { return encryptVaultPayload(payload); }
  private decryptVault(value:string):Payload {
    try { return decryptVaultPayload(value); }
    catch { return fail('Não foi possível abrir este item do cofre.',409); }
  }
  async vaultCategories(userId:string) {this.assertEnabled(); return this.db.query('SELECT id,name AS label,icon,position FROM vault_categories WHERE owner_id=$1 ORDER BY position,id',[userId]); }
  async createVaultCategory(userId:string,body:Payload) {this.assertEnabled();
    const name=value(body.name,'Nome da categoria',48);
    const icon=body.icon===undefined?'LockKeyhole':value(body.icon,'Ícone',32);
    if(!VAULT_CATEGORY_ICONS.has(icon))fail('Ícone da categoria inválido.');
    if(await this.db.one('SELECT id FROM vault_categories WHERE owner_id=$1 AND lower(name)=lower($2)',[userId,name]))fail('Essa categoria já existe.',409);
    return this.db.one('INSERT INTO vault_categories(owner_id,name,icon,position) VALUES($1,$2,$3,COALESCE((SELECT max(position)+1 FROM vault_categories WHERE owner_id=$1),0)) RETURNING id,name AS label,icon,position',[userId,name,icon]);
  }
  async reorderVaultCategories(userId:string,body:Payload) {this.assertEnabled();
    if(!Array.isArray(body.ids)||body.ids.some(id=>typeof id!=='string'))fail('Ordem das categorias inválida.');
    const ids=(body.ids as string[]).map(uuid);
    if(new Set(ids).size!==ids.length)fail('Ordem das categorias inválida.');
    const owned=await this.db.query<{id:string}>('SELECT id FROM vault_categories WHERE owner_id=$1',[userId]);
    if(owned.length!==ids.length||owned.some(category=>!ids.includes(category.id)))fail('A lista de categorias mudou. Atualize a página e tente novamente.',409);
    for(let position=0;position<ids.length;position++)await this.db.query('UPDATE vault_categories SET position=$3 WHERE id=$1 AND owner_id=$2',[ids[position],userId,position]);
    return this.vaultCategories(userId);
  }
  private async validateVaultCategory(userId:string,category:string) {
    if(BUILT_IN_VAULT_CATEGORIES.has(category))return;
    if(!await this.db.one('SELECT id FROM vault_categories WHERE id=$1 AND owner_id=$2',[uuid(category),userId]))fail('Categoria do cofre inválida.',400);
  }
  async vaultConstants(userId:string){this.assertEnabled();return vaultConstants(this.db,userId);}
  async vault(userId:string) {this.assertEnabled();const shared=await this.features.access?.sharedResources(userId,'vault')||[],root=Boolean((await this.db.one('SELECT is_root FROM users WHERE id=$1',[userId]))?.is_root);return this.db.query('SELECT v.id,COALESCE(c.title,v.title) AS title,v.category,v.created_at,v.updated_at,v.card_id,c.url_token,l.board_id FROM vault_items v LEFT JOIN cards c ON c.id=v.card_id LEFT JOIN lists l ON l.id=c.list_id WHERE v.owner_id=$1 OR v.id=ANY($2::uuid[]) OR $3 ORDER BY v.updated_at DESC',[userId,shared,root]); }

  async vaultItem(id:string,userId:string) {this.assertEnabled();
    uuid(id); const item=await this.db.one<{id:string;title:string;category:string;notes:string;secret_data:string;created_at:string;updated_at:string;card_id:string|null;url_token:string|null;board_id:string|null}>('SELECT v.id,COALESCE(c.title,v.title) AS title,v.category,COALESCE(c.description,v.notes) AS notes,v.secret_data,v.created_at,v.updated_at,v.card_id,c.url_token,l.board_id FROM vault_items v LEFT JOIN cards c ON c.id=v.card_id LEFT JOIN lists l ON l.id=c.list_id WHERE v.id=$1 AND v.owner_id=$2',[id,userId]);
    if(!item) return fail('Item do cofre não encontrado.',404);
    const stored=this.decryptVault(item.secret_data);
    const content_html=vaultItemHtml(stored,item.notes);
    const {notes,secret_data,...visible}=item;void notes;void secret_data;
    return {...visible,content_html,credentials:credentials(stored.credentials)};
  }
  async createVaultItem(userId:string,body:Payload) {this.assertEnabled();
    const title=value(body.title??'Novo texto','Título',300);const category=value(body.category??'custom','Categoria',48);await this.validateVaultCategory(userId,category);
    const content_html=body.content_html===undefined?'':sanitizeNotebookHtml(body.content_html);
    const row=await this.db.one<{id:string}>('INSERT INTO vault_items(owner_id,title,category,secret_data) VALUES($1,$2,$3,$4) RETURNING id',[userId,title,category,this.encryptVault({content_html,credentials:credentials(body.credentials)})]);
    return this.vaultItem(row!.id,userId);
  }
  async updateVaultItem(id:string,userId:string,body:Payload) {this.assertEnabled();
    uuid(id);const existing=await this.vaultItem(id,userId);
    const title=body.title===undefined?null:value(body.title,'Título',300);const category=body.category===undefined?null:value(body.category,'Categoria',48);
    if(category!==null)await this.validateVaultCategory(userId,category);
    const content_html=body.content_html===undefined?existing.content_html:sanitizeNotebookHtml(body.content_html);
    const client=await this.db.pool.connect();
    try{
      await client.query('BEGIN');
      const row=(await client.query('SELECT card_id,secret_data FROM vault_items WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,userId])).rows[0];
      if(!row)fail('Item do cofre não encontrado.',404);
      const fields=credentials(body.credentials===undefined?this.decryptVault(row.secret_data).credentials:body.credentials);
      await assertVaultReferencesRetained(this.db,userId,id,fields);
      await client.query("UPDATE vault_items SET title=$3,category=COALESCE($4,category),notes='',secret_data=$5,updated_at=now() WHERE id=$1 AND owner_id=$2",[id,userId,title??existing.title,category,this.encryptVault({content_html,credentials:fields})]);
      if(row.card_id)await client.query('UPDATE cards SET title=$2,description=$3,updated_at=now() WHERE id=$1',[row.card_id,title??existing.title,notebookHtmlToMarkdown(content_html)]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
    const updated=await this.vaultItem(id,userId);await refreshVaultEnvironment(userId,id,updated.credentials);return updated;
  }
  async deleteVaultItem(id:string,userId:string) {this.assertEnabled();
    uuid(id);await assertVaultReferencesRetained(this.db,userId,id,[]);const client=await this.db.pool.connect();
    try{
      await client.query('BEGIN');
      const item=(await client.query('DELETE FROM vault_items WHERE id=$1 AND owner_id=$2 RETURNING card_id',[id,userId])).rows[0];
      if(!item)fail('Item do cofre não encontrado.',404);
      if(item.card_id)await client.query('DELETE FROM cards WHERE id=$1',[item.card_id]);
      await client.query('COMMIT');return {ok:true};
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  async copyVaultToCard(id:string,userId:string,body:Payload) {this.assertEnabled();
    uuid(id);const listId=uuid(value(body.list_id,'Lista',36));const boardId=await this.listBoard(listId,userId);
    const item=await this.vaultItem(id,userId);
    const description=notebookHtmlToMarkdown(item.content_html);
    const card=await this.db.one<{id:string;url_token:string}>(`INSERT INTO cards(list_id,title,description,position,kind)
      VALUES($1,$2,$3,COALESCE((SELECT max(position)+1 FROM cards WHERE list_id=$1 AND archived_at IS NULL),0),'normal') RETURNING id,url_token`,[listId,item.title,description]);
    return {card_id:card!.id,board_id:boardId,url_token:card!.url_token};
  }
  async putCardInVault(cardId:string,userId:string,body:Payload) {this.assertEnabled();
    const boardId=await this.cardBoard(cardId,userId);
    const card=await this.db.one<{id:string;title:string;description:string;kind:string}>('SELECT id,title,description,kind FROM cards WHERE id=$1',[cardId]);
    if(!card)fail('Cartão não encontrado.',404);
    if(card!.kind!=='normal')fail('Somente cartões simples podem ser movidos para o cofre.',409);
    const category=value(body.category??'custom','Categoria',48);await this.validateVaultCategory(userId,category);
    const row=await this.db.one<{id:string}>('INSERT INTO vault_items(owner_id,title,category,notes,secret_data,card_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(card_id) DO NOTHING RETURNING id',[userId,card!.title,category,card!.description,this.encryptVault({}),cardId]);
    if(!row)fail('Este cartão já está no cofre.',409);
    await this.features.record(userId,boardId,cardId,'card_updated','moveu o cartão para o cofre');
    return this.vaultItem(row!.id,userId);
  }
  async restoreVaultCard(id:string,userId:string) {this.assertEnabled();
    uuid(id);await assertVaultReferencesRetained(this.db,userId,id,[]);const client=await this.db.pool.connect();
    try{await client.query('BEGIN');const item=(await client.query<{card_id:string|null;url_token:string|null;list_id:string|null}>('SELECT v.card_id,c.url_token,c.list_id FROM vault_items v LEFT JOIN cards c ON c.id=v.card_id WHERE v.id=$1 AND v.owner_id=$2 FOR UPDATE OF v',[id,userId])).rows[0];if(!item)fail('Item do cofre não encontrado.',404);if(!item.card_id||!item.list_id)fail('Este item não está associado a um cartão.',409);const board=(await client.query<{board_id:string}>('SELECT board_id FROM lists WHERE id=$1 AND archived_at IS NULL',[item.list_id])).rows[0];if(!board)fail('A lista original está arquivada ou não existe.',409);await client.query('DELETE FROM vault_items WHERE id=$1 AND owner_id=$2',[id,userId]);await client.query('COMMIT');return {card_id:item.card_id,url_token:item.url_token,board_id:board.board_id};}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
}
