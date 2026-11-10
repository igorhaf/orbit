import {Body,Controller,Delete,Get,Inject,Param,Patch,Post,Req,HttpException} from '@nestjs/common';
import type {Request} from 'express';
import {VaultService} from './vault.service';
import {BackupService} from '../../backup-service';
import {AccessService,type AccessRequest} from '../../access/access';
type Payload=Record<string,unknown>;
const fail=(message:string,code=400):never=>{throw new HttpException({message},code)};
@Controller()
export class VaultController{
 constructor(@Inject(VaultService)private service:VaultService,@Inject(BackupService)private backups:BackupService,@Inject(AccessService)private access:AccessService){}
 private async backupOwner(req:Request,write=false){this.service.assertEnabled();await this.access.require((req as AccessRequest).orbitActor||this.service.user(req),write?'vault.write':'vault.read');return this.service.user(req)}
  @Get('backups/vault') async vaultBackups(@Req() req:Request){return this.backups.listVault(await this.backupOwner(req,false))}
  @Post('backups/vault') async createVaultBackup(@Req() req:Request){try{return await this.backups.createVault(await this.backupOwner(req,false))}catch(error){return fail((error as Error).message,409)}}
  @Post('backups/vault/cloud/:copyId/download') async downloadVaultBackup(@Req() req:Request,@Param('copyId') copyId:string){try{return await this.backups.downloadVault(await this.backupOwner(req,false),copyId)}catch(error){return fail((error as Error).message,409)}}
  @Post('backups/vault/:archive/upload') async uploadVaultBackup(@Req() req:Request,@Param('archive') archive:string,@Body() body:Payload){try{return await this.backups.uploadExistingVault(await this.backupOwner(req,false),archive,body?.connectionId)}catch(error){return fail((error as Error).message,409)}}
  @Post('backups/vault/:archive/restore') async restoreVaultBackup(@Req() req:Request,@Param('archive') archive:string){try{return await this.backups.restoreVault(await this.backupOwner(req,true),archive)}catch(error){return fail((error as Error).message,409)}}
  @Get('vault/categories') vaultCategories(@Req() req:Request){return this.service.vaultCategories(this.service.user(req));}
  @Post('vault/categories') createVaultCategory(@Req() req:Request,@Body() body:Payload){return this.service.createVaultCategory(this.service.user(req),body);}
  @Patch('vault/categories/order') reorderVaultCategories(@Req() req:Request,@Body() body:Payload){return this.service.reorderVaultCategories(this.service.user(req),body);}
  @Get('vault') vault(@Req() req:Request){return this.service.vault(this.service.user(req));}
  @Post('vault') createVaultItem(@Req() req:Request,@Body() body:Payload){return this.service.createVaultItem(this.service.user(req),body);}
  @Get('vault/constants') vaultConstants(@Req() req:Request){return this.service.vaultConstants(this.service.user(req));}
  @Get('vault/:id') vaultItem(@Req() req:Request,@Param('id') id:string){return this.service.vaultItem(id,this.service.user(req));}
  @Patch('vault/:id') updateVaultItem(@Req() req:Request,@Param('id') id:string,@Body() body:Payload){return this.service.updateVaultItem(id,this.service.user(req),body);}
  @Post('vault/:id/copy-to-card') copyVaultToCard(@Req() req:Request,@Param('id') id:string,@Body() body:Payload){return this.service.copyVaultToCard(id,this.service.user(req),body);}
  @Delete('vault/:id') deleteVaultItem(@Req() req:Request,@Param('id') id:string){return this.service.deleteVaultItem(id,this.service.user(req));}
  @Post('vault/:id/restore-card') restoreVaultCard(@Req() req:Request,@Param('id') id:string){return this.service.restoreVaultCard(id,this.service.user(req));}
  @Post('cards/:id/vault') putCardInVault(@Req() req:Request,@Param('id') id:string,@Body() body:Payload){return this.service.putCardInVault(id,this.service.user(req),body);}
}
