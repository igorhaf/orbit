import { Body, Controller, Delete, Get, HttpException, Inject, Injectable, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { Db } from './db';
import { FeaturesService } from './features';
import { labelColorOptions } from './card-rules';

type Payload = Record<string, unknown>;
type ChecklistRow = { [key:string]:unknown; id:string; card_id:string; title:string; position:number };
type ItemRow = { [key:string]:unknown; id:string; card_id:string; checklist_id:string; text:string; completed:boolean; position:number; assignee_id:string|null; due_date:Date|null };
const bad=(message:string,status=400):never=>{throw new HttpException({message},status)};
const id=(value:string)=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))bad('ID inválido.');return value};
const text=(value:unknown,label:string,max:number)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max)bad(`${label} inválido.`);return (value as string).trim()};
const date=(value:unknown)=>{if(value===null||value==='')return null;if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))bad('Data inválida.');return new Date(value as string)};
const types=new Set(['text','number','date','dropdown','checkbox']);
const safeUrl=(input:unknown)=>{const value=text(input,'URL',2000);let url:URL;try{url=new URL(value)}catch{return bad('URL inválida.')};if(!['http:','https:'].includes(url.protocol))bad('Use uma URL HTTP ou HTTPS.');return url.toString()};

@Injectable()
export class CardExtensionsService {
  constructor(@Inject(Db) private db:Db,@Inject(FeaturesService) private features:FeaturesService) {}
  user(req:Request){return this.features.user(req)}
  async card(cardId:string,userId:string){
    const boardId=await this.features.cardBoard(id(cardId),userId);
    const row=await this.db.one('SELECT kind FROM cards WHERE id=$1',[cardId]);
    if(!row||!['normal','template'].includes(row.kind))bad('Este tipo de cartão não possui detalhes editáveis.',409);
    return boardId;
  }
  async board(boardId:string,userId:string){await this.features.member(id(boardId),userId)}
  async checklist(checklistId:string,userId:string){
    const row=await this.db.one<ChecklistRow>('SELECT cl.* FROM checklists cl WHERE cl.id=$1',[id(checklistId)]);
    if(!row)bad('Checklist não encontrado.',404);
    const boardId=await this.card(row!.card_id,userId);
    return {...row!,board_id:boardId};
  }
  async item(itemId:string,userId:string){
    const row=await this.db.one<ItemRow>('SELECT ci.* FROM checklist_items ci WHERE ci.id=$1',[id(itemId)]);
    if(!row)bad('Item não encontrado.',404);
    const boardId=await this.card(row!.card_id,userId);
    return {...row!,board_id:boardId};
  }
  async details(cardId:string,userId:string){
    const boardId=await this.card(cardId,userId);
    const [checklists,items,values,attachments]=await Promise.all([
      this.db.query('SELECT * FROM checklists WHERE card_id=$1 ORDER BY position,id',[cardId]),
      this.db.query('SELECT ci.id,ci.card_id,ci.checklist_id,ci.text,ci.completed,ci.position,ci.assignee_id,ci.due_date,u.name AS assignee_name FROM checklist_items ci LEFT JOIN users u ON u.id=ci.assignee_id WHERE ci.card_id=$1 ORDER BY ci.position,ci.id',[cardId]),
      this.db.query('SELECT v.field_id,v.value FROM card_custom_values v JOIN custom_fields f ON f.id=v.field_id WHERE v.card_id=$1 AND f.board_id=$2',[cardId,boardId]),
      this.db.query('SELECT id,card_id,kind,name,url,target_id,mime_type,size_bytes,position,created_at FROM attachments WHERE card_id=$1 ORDER BY position,id',[cardId]),
    ]);
    return {checklists:checklists.map(checklist=>({...checklist,items:items.filter(item=>item.checklist_id===checklist.id)})),values,attachments};
  }
  async catalog(boardId:string,userId:string){await this.board(boardId,userId);return this.db.query(`SELECT cl.id,cl.title,c.title AS card_title FROM checklists cl JOIN cards c ON c.id=cl.card_id JOIN lists l ON l.id=c.list_id WHERE l.board_id=$1 AND l.archived_at IS NULL AND c.archived_at IS NULL ORDER BY c.title,cl.position`,[boardId])}
  async createChecklist(cardId:string,userId:string,body:Payload){
    const boardId=await this.card(cardId,userId);
    const title=text(body.title,'Título',160);
    let source:string|null=null;
    if(body.source_id){const sourceGroup=await this.checklist(String(body.source_id),userId);if(sourceGroup.board_id!==boardId)bad('O checklist de origem deve pertencer ao mesmo quadro.');source=sourceGroup.id}
    const client=await this.db.pool.connect();
    try{
      await client.query('BEGIN');
      const group=(await client.query('INSERT INTO checklists(card_id,title,position) VALUES($1,$2,COALESCE((SELECT max(position)+1 FROM checklists WHERE card_id=$1),0)) RETURNING *',[cardId,title])).rows[0];
      if(source)await client.query(`INSERT INTO checklist_items(card_id,checklist_id,text,completed,position,assignee_id,due_date)
        SELECT $1,$2,text,completed,position,assignee_id,due_date FROM checklist_items WHERE checklist_id=$3 ORDER BY position`,[cardId,group.id,source]);
      await client.query('COMMIT');
      await this.features.record(userId,boardId,cardId,'checklist_created',`criou o checklist ${title}`);
      return group;
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  async updateChecklist(checklistId:string,userId:string,body:Payload){
    const group=await this.checklist(checklistId,userId);
    const title=body.title===undefined?group.title:text(body.title,'Título',160);
    if(body.position!==undefined){
      const client=await this.db.pool.connect();
      try{await client.query('BEGIN');await client.query('SELECT id FROM cards WHERE id=$1 FOR UPDATE',[group.card_id]);
        const rows=(await client.query('SELECT id FROM checklists WHERE card_id=$1 ORDER BY position,id',[group.card_id])).rows.map(row=>row.id as string);
        const target=Number(body.position);if(!Number.isInteger(target)||target<0||target>=rows.length)bad('Posição inválida.');
        rows.splice(rows.indexOf(checklistId),1);rows.splice(target,0,checklistId);
        for(let i=0;i<rows.length;i++)await client.query('UPDATE checklists SET position=$2 WHERE id=$1',[rows[i],i]);
        await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
    }
    return this.db.one('UPDATE checklists SET title=$2 WHERE id=$1 RETURNING *',[checklistId,title]);
  }
  async deleteChecklist(checklistId:string,userId:string){await this.checklist(checklistId,userId);await this.db.query('DELETE FROM checklists WHERE id=$1',[checklistId]);return {ok:true}}
  async addItems(checklistId:string,userId:string,body:Payload){
    const group=await this.checklist(checklistId,userId);
    const raw=typeof body.text==='string'?body.text:'';
    if(raw.length>30000)bad('Texto muito longo.');
    const lines=raw.split(/\r?\n/).map(line=>line.replace(/\t/g,' ').trim()).filter(Boolean);
    if(!lines.length||lines.length>100||lines.some(line=>line.length>300))bad('Informe de 1 a 100 itens com até 300 caracteres.');
    const client=await this.db.pool.connect();
    try{await client.query('BEGIN');await client.query('SELECT id FROM checklists WHERE id=$1 FOR UPDATE',[checklistId]);
      const offset=(await client.query('SELECT COALESCE(max(position)+1,0) AS next FROM checklist_items WHERE checklist_id=$1',[checklistId])).rows[0].next;
      const created=[];
      for(let index=0;index<lines.length;index++)created.push((await client.query('INSERT INTO checklist_items(card_id,checklist_id,text,position) VALUES($1,$2,$3,$4) RETURNING *',[group.card_id,checklistId,lines[index],Number(offset)+index])).rows[0]);
      await client.query('COMMIT');await this.features.record(userId,group.board_id,group.card_id,'checklist_created',`adicionou ${created.length} item(ns) ao checklist`);return created;
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  async updateItem(itemId:string,userId:string,body:Payload){
    const item=await this.item(itemId,userId);
    const title=body.text===undefined?item.text:text(body.text,'Item',300);
    const completed=body.completed===undefined?item.completed:body.completed;
    if(typeof completed!=='boolean')bad('Status inválido.');
    let assignee=item.assignee_id;
    if(body.assignee_id!==undefined){assignee=body.assignee_id===null?null:id(String(body.assignee_id));if(assignee&&!await this.db.one('SELECT 1 FROM board_members WHERE board_id=$1 AND user_id=$2',[item.board_id,assignee]))bad('Membro não pertence ao quadro.');}
    const dueDate=body.due_date===undefined?item.due_date:date(body.due_date);
    const target=body.checklist_id===undefined?item.checklist_id:id(String(body.checklist_id));
    if(target!==item.checklist_id){const group=await this.checklist(target,userId);if(group.card_id!==item.card_id)bad('O checklist deve pertencer ao mesmo cartão.');}
    if(body.position!==undefined||target!==item.checklist_id){
      const client=await this.db.pool.connect();
      try{await client.query('BEGIN');await client.query('SELECT id FROM cards WHERE id=$1 FOR UPDATE',[item.card_id]);
        const source=(await client.query('SELECT id FROM checklist_items WHERE checklist_id=$1 ORDER BY position,id',[item.checklist_id])).rows.map(row=>row.id as string).filter(value=>value!==itemId);
        const destination=target===item.checklist_id?source:(await client.query('SELECT id FROM checklist_items WHERE checklist_id=$1 ORDER BY position,id',[target])).rows.map(row=>row.id as string);
        const index=body.position===undefined?destination.length:Number(body.position);
        if(!Number.isInteger(index)||index<0||index>destination.length)bad('Posição inválida.');
        destination.splice(index,0,itemId);
        await client.query('UPDATE checklist_items SET checklist_id=$2 WHERE id=$1',[itemId,target]);
        for(let i=0;i<source.length;i++)await client.query('UPDATE checklist_items SET position=$2 WHERE id=$1',[source[i],i]);
        if(target!==item.checklist_id)for(let i=0;i<destination.length;i++)await client.query('UPDATE checklist_items SET position=$2 WHERE id=$1',[destination[i],i]);
        else for(let i=0;i<destination.length;i++)await client.query('UPDATE checklist_items SET position=$2 WHERE id=$1',[destination[i],i]);
        await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
    }
    const updated=await this.db.one('UPDATE checklist_items SET text=$2,completed=$3,assignee_id=$4,due_date=$5 WHERE id=$1 RETURNING *',[itemId,title,completed,assignee,dueDate]);
    if(body.completed!==undefined)await this.features.record(userId,item.board_id,item.card_id,'checklist_updated',completed?'concluiu um item de checklist':'reabriu um item de checklist');
    if(assignee&&assignee!==item.assignee_id)await this.features.notify(assignee,item.board_id,item.card_id,'checklist','Item atribuído a você',title);
    return updated;
  }
  async deleteItem(itemId:string,userId:string){await this.item(itemId,userId);await this.db.query('DELETE FROM checklist_items WHERE id=$1',[itemId]);return {ok:true}}
  async convertItem(itemId:string,userId:string,body:Payload){
    const item=await this.item(itemId,userId);
    const parent=await this.db.one('SELECT list_id FROM cards WHERE id=$1',[item.card_id]);
    const listId=body.list_id===undefined?parent!.list_id:id(String(body.list_id));
    const destination=await this.db.one('SELECT board_id,archived_at FROM lists WHERE id=$1',[listId]);
    if(!destination||destination.board_id!==item.board_id||destination.archived_at)bad('Lista de destino inválida.');
    const client=await this.db.pool.connect();
    try{await client.query('BEGIN');
      const card=(await client.query(`INSERT INTO cards(list_id,title,due_date,position) VALUES($1,$2,$3,COALESCE((SELECT max(position)+1 FROM cards WHERE list_id=$1 AND archived_at IS NULL),0)) RETURNING *`,[listId,item.text,item.due_date])).rows[0];
      if(item.assignee_id)await client.query('INSERT INTO card_assignees(card_id,user_id) VALUES($1,$2)',[card.id,item.assignee_id]);
      await client.query('DELETE FROM checklist_items WHERE id=$1',[itemId]);
      await client.query('COMMIT');await this.features.record(userId,item.board_id,card.id,'card_created',`converteu o item ${item.text} em cartão`);return card;
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  async fields(boardId:string,userId:string){await this.board(boardId,userId);return this.db.query('SELECT * FROM custom_fields WHERE board_id=$1 ORDER BY position,id',[boardId])}
  private fieldInput(body:Payload,old?:{name:string;type:string;options:unknown;show_on_card:boolean}){
    const name=body.name===undefined?old?.name:text(body.name,'Nome',100);
    const type=body.type===undefined?old?.type:text(body.type,'Tipo',16);
    if(!name||!type||!types.has(type))bad('Campo inválido.');
    const raw=body.options===undefined?old?.options??[]:body.options;
    if(!Array.isArray(raw)||raw.length>50||raw.some(option=>typeof option!=='string'||!option.trim()||option.trim().length>100))bad('Opções inválidas.');
    const options=(raw as string[]).map(option=>option.trim());
    if(type==='dropdown'&&(!options.length||new Set(options).size!==options.length))bad('Defina opções únicas para o dropdown.');
    if(type!=='dropdown'&&options.length)bad('Apenas dropdown aceita opções.');
    const show=body.show_on_card===undefined?old?.show_on_card??true:body.show_on_card;
    if(typeof show!=='boolean')bad('Visibilidade inválida.');
    return {name,type,options,show};
  }
  async createField(boardId:string,userId:string,body:Payload){await this.board(boardId,userId);const field=this.fieldInput(body);return this.db.one('INSERT INTO custom_fields(board_id,name,type,options,position,show_on_card) VALUES($1,$2,$3,$4,COALESCE((SELECT max(position)+1 FROM custom_fields WHERE board_id=$1),0),$5) RETURNING *',[boardId,field.name,field.type,JSON.stringify(field.options),field.show])}
  async updateField(boardId:string,fieldId:string,userId:string,body:Payload){await this.board(boardId,userId);const old=await this.db.one('SELECT * FROM custom_fields WHERE id=$1 AND board_id=$2',[id(fieldId),boardId]);if(!old)bad('Campo não encontrado.',404);const field=this.fieldInput(body,old as {name:string;type:string;options:unknown;show_on_card:boolean});if(field.type!==old!.type)bad('Não é possível alterar o tipo de um campo.');const updated=await this.db.one('UPDATE custom_fields SET name=$3,options=$4,show_on_card=$5 WHERE id=$1 AND board_id=$2 RETURNING *',[fieldId,boardId,field.name,JSON.stringify(field.options),field.show]);if(field.type==='dropdown')await this.db.query(`DELETE FROM card_custom_values WHERE field_id=$1 AND NOT (value #>> '{}')=ANY($2::text[])`,[fieldId,field.options]);return updated}
  async deleteField(boardId:string,fieldId:string,userId:string){await this.board(boardId,userId);const result=await this.db.one('DELETE FROM custom_fields WHERE id=$1 AND board_id=$2 RETURNING id',[id(fieldId),boardId]);if(!result)bad('Campo não encontrado.',404);return {ok:true}}
  async setValue(cardId:string,fieldId:string,userId:string,body:Payload){const boardId=await this.card(cardId,userId);const field=await this.db.one('SELECT * FROM custom_fields WHERE id=$1 AND board_id=$2',[id(fieldId),boardId]);if(!field)bad('Campo não encontrado.',404);const input=body.value;if(input===null||input===''){await this.db.query('DELETE FROM card_custom_values WHERE card_id=$1 AND field_id=$2',[cardId,fieldId]);return {value:null}}
    let value:unknown=input;
    if(field!.type==='text')value=text(input,'Valor',1000);
    else if(field!.type==='number'){if(typeof input!=='number'||!Number.isFinite(input))bad('Número inválido.');}
    else if(field!.type==='date')value=date(input)?.toISOString();
    else if(field!.type==='dropdown'){if(typeof input!=='string'||!(field!.options as string[]).includes(input))bad('Opção inválida.');}
    else if(typeof input!=='boolean')bad('Valor booleano inválido.');
    return this.db.one('INSERT INTO card_custom_values(card_id,field_id,value) VALUES($1,$2,$3) ON CONFLICT(card_id,field_id) DO UPDATE SET value=excluded.value RETURNING *',[cardId,fieldId,JSON.stringify(value)]);
  }
  async attachment(attachmentId:string,userId:string){const row=await this.db.one('SELECT * FROM attachments WHERE id=$1',[id(attachmentId)]);if(!row)bad('Anexo não encontrado.',404);await this.card(row!.card_id,userId);return row!}
  async addAttachment(cardId:string,userId:string,body:Payload){const boardId=await this.card(cardId,userId);const kind=text(body.kind,'Tipo',8);if(!['file','url','card','board'].includes(kind))bad('Tipo de anexo inválido.');const name=text(body.name,'Nome',255);
    let url:string|null=null,target:string|null=null,mime:string|null=null,buffer:Buffer|null=null;
    if(kind==='url')url=safeUrl(body.url);
    else if(kind==='card'||kind==='board'){
      target=id(String(body.target_id));
      if(kind==='board'){await this.board(target,userId);url=`/board/${target}`}
      else {const targetBoard=await this.card(target,userId);url=`/board/${targetBoard}?card=${target}`}
    }else{
      mime=text(body.mime_type,'Formato',120).toLowerCase();
      const raw=body.data;
      if(typeof raw!=='string'||raw.length>14000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw))bad('Arquivo inválido ou maior que 10 MB.');
      buffer=Buffer.from(raw as string,'base64');if(!buffer.length||buffer.length>10_000_000||buffer.toString('base64')!==raw)bad('Arquivo inválido ou maior que 10 MB.');
      if(mime.startsWith('image/')&&buffer.length>2_000_000)bad('Imagens devem ter até 2 MB para uso como capa.');
      if(mime.startsWith('image/')&&!['image/png','image/jpeg','image/webp','image/gif'].includes(mime))bad('Formato de imagem não suportado.');
      const signatures:Record<string,boolean>={'image/png':buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'image/jpeg':buffer[0]===255&&buffer[1]===216,'image/webp':buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP','image/gif':buffer.toString('ascii',0,3)==='GIF'};
      if(mime.startsWith('image/')&&!signatures[mime])bad('O arquivo não corresponde ao formato informado.');
    }
    const attachment=await this.db.one(`INSERT INTO attachments(card_id,kind,name,url,target_id,mime_type,size_bytes,data,position)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE((SELECT max(position)+1 FROM attachments WHERE card_id=$1),0)) RETURNING id,card_id,kind,name,url,target_id,mime_type,size_bytes,position,created_at`,[cardId,kind,name,url,target,mime,buffer?.length??null,buffer]);
    if(kind==='file'&&mime?.startsWith('image/'))await this.db.query('UPDATE cards SET cover_attachment_id=$2 WHERE id=$1 AND cover_attachment_id IS NULL AND cover_color IS NULL',[cardId,attachment!.id]);
    await this.features.record(userId,boardId,cardId,'attachment',`anexou ${name}`);
    return attachment;
  }
  async updateAttachment(attachmentId:string,userId:string,body:Payload){const attachment=await this.attachment(attachmentId,userId);const name=body.name===undefined?attachment.name:text(body.name,'Nome',255);
    if(body.position!==undefined){const client=await this.db.pool.connect();try{await client.query('BEGIN');await client.query('SELECT id FROM cards WHERE id=$1 FOR UPDATE',[attachment.card_id]);const ids=(await client.query('SELECT id FROM attachments WHERE card_id=$1 ORDER BY position,id',[attachment.card_id])).rows.map(row=>row.id as string);const target=Number(body.position);if(!Number.isInteger(target)||target<0||target>=ids.length)bad('Posição inválida.');ids.splice(ids.indexOf(attachmentId),1);ids.splice(target,0,attachmentId);for(let i=0;i<ids.length;i++)await client.query('UPDATE attachments SET position=$2 WHERE id=$1',[ids[i],i]);await client.query('COMMIT')}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}}
    return this.db.one('UPDATE attachments SET name=$2 WHERE id=$1 RETURNING id,card_id,kind,name,url,target_id,mime_type,size_bytes,position,created_at',[attachmentId,name])}
  async deleteAttachment(attachmentId:string,userId:string){await this.attachment(attachmentId,userId);await this.db.query('DELETE FROM attachments WHERE id=$1',[attachmentId]);return {ok:true}}
  async cover(cardId:string,userId:string,body:Payload){await this.card(cardId,userId);const size=body.size===undefined?'normal':body.size;if(!['normal','full'].includes(String(size)))bad('Tamanho inválido.');let attachmentId:null|string=null;if(body.attachment_id!==undefined&&body.attachment_id!==null){attachmentId=id(String(body.attachment_id));const file=await this.attachment(attachmentId,userId);if(file.card_id!==cardId||file.kind!=='file'||!file.mime_type?.startsWith('image/'))bad('Escolha uma imagem deste cartão.')}const color=body.color===undefined?null:body.color;if(color!==null&&(typeof color!=='string'||color==='none'||!labelColorOptions.has(color)))bad('Cor inválida.');return this.db.one('UPDATE cards SET cover_attachment_id=$2,cover_color=$3,cover_size=$4 WHERE id=$1 RETURNING id,cover_attachment_id,cover_color,cover_size',[cardId,attachmentId,color,size])}
  async content(attachmentId:string,userId:string,response:Response){const attachment=await this.attachment(attachmentId,userId);if(attachment.kind!=='file'||!attachment.data)bad('Arquivo indisponível.',404);const mime=attachment.mime_type||'application/octet-stream';const inline=['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain'].includes(mime);response.setHeader('Content-Type',mime);response.setHeader('Content-Length',attachment.data.length);response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Disposition',`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`);response.send(attachment.data)}
}

@Controller()
export class CardExtensionsController {
  constructor(@Inject(CardExtensionsService) private service:CardExtensionsService){}
  @Get('cards/:cardId/extensions') details(@Req() request:Request,@Param('cardId') cardId:string){return this.service.details(cardId,this.service.user(request))}
  @Get('boards/:boardId/checklists/catalog') catalog(@Req() request:Request,@Param('boardId') boardId:string){return this.service.catalog(boardId,this.service.user(request))}
  @Post('cards/:cardId/checklists') createChecklist(@Req() request:Request,@Param('cardId') cardId:string,@Body() body:Payload){return this.service.createChecklist(cardId,this.service.user(request),body)}
  @Patch('checklists/:id') updateChecklist(@Req() request:Request,@Param('id') id:string,@Body() body:Payload){return this.service.updateChecklist(id,this.service.user(request),body)}
  @Delete('checklists/:id') deleteChecklist(@Req() request:Request,@Param('id') id:string){return this.service.deleteChecklist(id,this.service.user(request))}
  @Post('checklists/:id/items') addItems(@Req() request:Request,@Param('id') id:string,@Body() body:Payload){return this.service.addItems(id,this.service.user(request),body)}
  @Patch('checklist-items/:id') updateItem(@Req() request:Request,@Param('id') id:string,@Body() body:Payload){return this.service.updateItem(id,this.service.user(request),body)}
  @Delete('checklist-items/:id') deleteItem(@Req() request:Request,@Param('id') id:string){return this.service.deleteItem(id,this.service.user(request))}
  @Post('checklist-items/:id/convert') convertItem(@Req() request:Request,@Param('id') id:string,@Body() body:Payload){return this.service.convertItem(id,this.service.user(request),body)}
  @Get('boards/:boardId/custom-fields') fields(@Req() request:Request,@Param('boardId') boardId:string){return this.service.fields(boardId,this.service.user(request))}
  @Post('boards/:boardId/custom-fields') createField(@Req() request:Request,@Param('boardId') boardId:string,@Body() body:Payload){return this.service.createField(boardId,this.service.user(request),body)}
  @Patch('boards/:boardId/custom-fields/:id') updateField(@Req() request:Request,@Param('boardId') boardId:string,@Param('id') id:string,@Body() body:Payload){return this.service.updateField(boardId,id,this.service.user(request),body)}
  @Delete('boards/:boardId/custom-fields/:id') deleteField(@Req() request:Request,@Param('boardId') boardId:string,@Param('id') id:string){return this.service.deleteField(boardId,id,this.service.user(request))}
  @Post('cards/:cardId/custom-fields/:id') setValue(@Req() request:Request,@Param('cardId') cardId:string,@Param('id') id:string,@Body() body:Payload){return this.service.setValue(cardId,id,this.service.user(request),body)}
  @Post('cards/:cardId/attachments') addAttachment(@Req() request:Request,@Param('cardId') cardId:string,@Body() body:Payload){return this.service.addAttachment(cardId,this.service.user(request),body)}
  @Patch('attachments/:id') updateAttachment(@Req() request:Request,@Param('id') id:string,@Body() body:Payload){return this.service.updateAttachment(id,this.service.user(request),body)}
  @Delete('attachments/:id') deleteAttachment(@Req() request:Request,@Param('id') id:string){return this.service.deleteAttachment(id,this.service.user(request))}
  @Get('attachments/:id/content') content(@Req() request:Request,@Param('id') id:string,@Res() response:Response){return this.service.content(id,this.service.user(request),response)}
  @Patch('cards/:cardId/cover') cover(@Req() request:Request,@Param('cardId') cardId:string,@Body() body:Payload){return this.service.cover(cardId,this.service.user(request),body)}
}
