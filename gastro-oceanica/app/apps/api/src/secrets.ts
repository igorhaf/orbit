import {Injectable} from '@nestjs/common';
import {configuredKeys,openJson,sealJson} from './keyring-crypto';

@Injectable()
export class SecretVault {
  private activeKey(){const secret=process.env.ORBIT_SECRET_KEY||process.env.JWT_SECRET;if(!secret)throw new Error('Configure ORBIT_SECRET_KEY.');return secret}
  private keyring(){return configuredKeys(process.env.ORBIT_SECRET_KEY,process.env.ORBIT_SECRET_KEY_PREVIOUS,process.env.JWT_SECRET)}
  seal(value:unknown){return sealJson(value,this.activeKey(),'orbit-integrations')}
  open<T>(sealed:string):T{return openJson<T>(sealed,this.keyring(),'orbit-integrations')}
}
