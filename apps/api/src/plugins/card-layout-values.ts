import type {PluginDefinition} from './contract';
export function cardLayoutValues(plugins:PluginDefinition[],selected:string[],data:Record<string,Record<string,string>>={}){
 const badges:Array<{pluginId:string;field:string;value:string;label:string;color:string}>=[];let executionBlocked=false;
 for(const plugin of plugins.filter(plugin=>selected.includes(plugin.id)))for(const layout of plugin.contributions?.cardLayouts||[])for(const field of layout.fields||[]){
  const value=data[plugin.id]?.[field.key]||'',option=field.options?.find(option=>option.value===value);
  if(option?.blocksExecution)executionBlocked=true;
  if(field.showOnCard)badges.push({pluginId:plugin.id,field:field.key,value,label:option?.label||'Não classificado',color:option?.color||'gray'});
 }
 return {badges,executionBlocked};
}

export function childCardLayoutData(plugins:PluginDefinition[],data:Record<string,Record<string,string>>){
 const result=structuredClone(data);
 for(const plugin of plugins)for(const layout of plugin.contributions?.cardLayouts||[])for(const field of layout.fields||[])if(field.childDefault&&result[plugin.id])result[plugin.id][field.key]=field.childDefault;
 return result;
}
