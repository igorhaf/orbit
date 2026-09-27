import {Injectable} from '@nestjs/common';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';

@Injectable()
export class SecretVault {
  private key(){const secret=process.env.ORBIT_SECRET_KEY||process.env.JWT_SECRET;if(!secret)throw new Error('Configure ORBIT_SECRET_KEY.');return createHash('sha256').update(secret).digest()}
  seal(value:unknown){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key(),iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.')}
  open<T>(sealed:string):T{const [version,iv,tag,data]=sealed.split('.');if(version!=='v1'||!iv||!tag||!data)throw new Error('Secret inválido.');const decipher=createDecipheriv('aes-256-gcm',this.key(),Buffer.from(iv,'base64url'));decipher.setAuthTag(Buffer.from(tag,'base64url'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString('utf8')) as T}
}
