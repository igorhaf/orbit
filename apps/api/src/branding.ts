import { Body, Controller, Get, HttpException, Inject, Patch, Req } from '@nestjs/common';
import { Request } from 'express';
import { Db } from './db';
import { FeaturesService } from './features';

type Brand = {app_name:string;icon_kind:'orbit'|'tree_of_life'|'custom';custom_icon_data:string|null;login_tagline:string;login_description:string;login_benefits:string[]};
const defaults:Brand={app_name:'Orbit',icon_kind:'orbit',custom_icon_data:null,login_tagline:'Seu trabalho, com uma visão mais clara.',login_description:'Acompanhe o que vem pela frente, veja as novidades e organize seus projetos em quadros.',login_benefits:['Tarefas e prazos em destaque','Quadros, listas e cartões','Atividade e notificações em um lugar']};

@Controller('branding')
export class BrandingController {
  constructor(@Inject(Db) private db:Db,@Inject(FeaturesService) private features:FeaturesService) {}
  private async read():Promise<Brand>{return await this.db.one<Brand>('SELECT app_name,icon_kind,custom_icon_data,login_tagline,login_description,login_benefits FROM instance_branding WHERE id=true')||defaults}
  @Get()
  async publicBrand(){const brand=await this.read();return brand}
  @Patch()
  async update(@Req() req:Request,@Body() body:Record<string,unknown>){
    const actor=this.features.user(req);
    const account=await this.db.one<{is_root:boolean}>('SELECT is_root FROM users WHERE id=$1',[actor]);
    if(!account?.is_root)throw new HttpException('Somente o usuário ROOT pode alterar a identidade da aplicação.',403);
    const appName=typeof body.app_name==='string'?body.app_name.trim():'';
    const kind=body.icon_kind;
    const custom=body.custom_icon_data;
    const tagline=typeof body.login_tagline==='string'?body.login_tagline.trim():'';
    const description=typeof body.login_description==='string'?body.login_description.trim():'';
    const benefits=body.login_benefits;
    if(!appName||appName.length>80)throw new HttpException('Informe um nome de até 80 caracteres.',400);
    if(!['orbit','tree_of_life','custom'].includes(String(kind)))throw new HttpException('Escolha um ícone válido.',400);
    if(!tagline||tagline.length>180||!description||description.length>500)throw new HttpException('Revise o título e a descrição da tela de login.',400);
    if(!Array.isArray(benefits)||benefits.length<1||benefits.length>5||benefits.some(item=>typeof item!=='string'||!item.trim()||item.length>120))throw new HttpException('Informe de 1 a 5 benefícios, com até 120 caracteres cada.',400);
    if(kind==='custom'&&(typeof custom!=='string'||custom.length>350000||!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(custom)))throw new HttpException('Use uma imagem PNG, JPEG ou WebP de até 250 KB.',400);
    const customData=kind==='custom'?custom as string:null;
    await this.db.query(`INSERT INTO instance_branding(id,app_name,icon_kind,custom_icon_data,login_tagline,login_description,login_benefits,login_content_customized,updated_at) VALUES(true,$1,$2,$3,$4,$5,$6::jsonb,true,now()) ON CONFLICT(id) DO UPDATE SET app_name=EXCLUDED.app_name,icon_kind=EXCLUDED.icon_kind,custom_icon_data=EXCLUDED.custom_icon_data,login_tagline=EXCLUDED.login_tagline,login_description=EXCLUDED.login_description,login_benefits=EXCLUDED.login_benefits,login_content_customized=true,updated_at=now()`,[appName,kind,customData,tagline,description,JSON.stringify(benefits.map(item=>(item as string).trim()))]);
    return this.read();
  }
}
