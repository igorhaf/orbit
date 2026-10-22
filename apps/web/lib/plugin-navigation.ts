export type NavigationGroup = {id:string;label:string;order?:number};
export type PluginNavigationLink = {id:string;label:string;href:string;permission?:string;order?:number;group?:NavigationGroup;section?:NavigationGroup};
export type NavigationCatalogPlugin = {enabled:boolean;contributions?:{navigation?:unknown[]}};
export type NavigationSection = {id:string;label:string;order?:number;links:PluginNavigationLink[]};
export type NavigationMenu = {id:string;label:string;order?:number;sections:NavigationSection[]};
const reserved=new Set(['/','/boards','/calendar','/plugins','/extensions']);
const validGroup=(value:unknown):value is NavigationGroup=>Boolean(value&&typeof value==='object'&&'id' in value&&typeof value.id==='string'&&/^[a-z][a-z0-9-]*$/.test(value.id)&&'label' in value&&typeof value.label==='string'&&value.label.trim());
const compare=(a:{order?:number},b:{order?:number})=>(a.order??0)-(b.order??0);

/** Only enabled, authorized contributions enter either desktop or mobile navigation. */
export function pluginNavigation(catalog:NavigationCatalogPlugin[],permitted:(permission:string)=>boolean){
 const links:PluginNavigationLink[]=[];const seen=new Set<string>();
 for(const plugin of catalog.filter(item=>item.enabled))for(const raw of plugin.contributions?.navigation||[]){
  if(!raw||typeof raw!=='object')continue;
  const item=raw as Partial<PluginNavigationLink>;
  if(typeof item.id!=='string'||!item.id||typeof item.label!=='string'||!item.label.trim()||typeof item.href!=='string'||!/^\/[a-z0-9/-]+$/.test(item.href)||reserved.has(item.href)||seen.has(item.href))continue;
  if(item.permission&&!permitted(item.permission))continue;
  if(item.group!==undefined&&!validGroup(item.group)||item.section!==undefined&&(!item.group||!validGroup(item.section)))continue;
  seen.add(item.href);links.push(item as PluginNavigationLink);
 }
 const menus:NavigationMenu[]=[];
 for(const item of links.filter(link=>link.group)){
  const group=item.group!;let menu=menus.find(menu=>menu.id===group.id);
  if(!menu){menu={...group,sections:[]};menus.push(menu)}
  const category=item.section||{id:'general',label:'',order:0};let section=menu.sections.find(section=>section.id===category.id);
  if(!section){section={...category,links:[]};menu.sections.push(section)}
  section.links.push(item);
 }
 for(const menu of menus){menu.sections.sort(compare);for(const section of menu.sections)section.links.sort(compare)}
 return {links,standalone:links.filter(link=>!link.group).sort(compare),menus:menus.sort(compare)};
}
