import {hasBoardViewAfterChange,REQUIRED_BOARD_VIEW_PLUGIN_IDS} from '../plugins/board-views/required-views';
import {
 EditorialAuthorizationGenerationError,
 type EditorialAuthorizationGenerationRef,
 type EditorialAuthorizationGenerationRepository,
} from './editorial-authorization-generation';

const requiredViews:readonly string[]=REQUIRED_BOARD_VIEW_PLUGIN_IDS;

export class RequiredBoardViewError extends EditorialAuthorizationGenerationError{
 readonly reason='required_board_view';
 constructor(){
  super('editorial_generation_operation_failed');
  this.name='RequiredBoardViewError';
 }
}

/** Experimental server writer. The caller owns installed-plugin and product-profile checks.
 * Order: generation row, required board view advisory lock if applicable, plugin settings DML.
 */
export async function writeEditorialPluginSetting(
 repository:EditorialAuthorizationGenerationRepository,
 expected:EditorialAuthorizationGenerationRef,
 pluginId:string,
 enabled:boolean,
){
 if(typeof pluginId!=='string'||pluginId.length>100||!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(pluginId)||
  typeof enabled!=='boolean')throw new TypeError('editorial_plugin_setting_invalid');
 return repository.advance(expected,async db=>{
  if(!enabled&&requiredViews.includes(pluginId)){
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended('orbit.required-board-view',0))");
   const {rows}: {rows:{plugin_id:string;enabled:boolean}[]}=
    await db.query('SELECT plugin_id,enabled FROM plugin_settings WHERE plugin_id=ANY($1::text[])',[requiredViews]);
   const states=new Map(rows.map(row=>[row.plugin_id,row.enabled]));
   if(!hasBoardViewAfterChange(states,pluginId,enabled))throw new RequiredBoardViewError();
  }
  await db.query(`INSERT INTO plugin_settings(plugin_id,enabled) VALUES($1,$2)
   ON CONFLICT(plugin_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`,[pluginId,enabled]);
 });
}
