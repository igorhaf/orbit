import {canonicalContextJson,hashContextValue} from './context-manifest';

const commonFamilies=[
 'scope','membership','board_policy','board_access','board_list','board_scope','board_members',
 'board_listing_policy','record_permission','resource_availability','resources',
];
const suindaFamilies=['scoped_permission','request_permission'];
const knownFamilies=new Set([...commonFamilies,...suindaFamilies]);

type ProviderObservation={family:string;count:number;ids?:readonly string[]};
type Provider={readonly family:string;readonly count:number;readonly ids:readonly string[]};
type PluginDefinitionObservation={id:string;version:string;dependencies?:readonly string[];parentPlugin?:string};
type Plugin=Readonly<{
 id:string;version:string;dependencies:readonly string[];parentPlugin:string|null;
 installed:boolean;enabled:boolean;configuredEnabled:boolean|null;
}>;
type Reason='live_sources_unsealed'|'plugin_inventory_partial'|'provider_inventory_partial'|
 'unknown_provider_family'|'provider_not_homologated'|'provider_detection_mismatch';

export type EditorialAuthorizationSnapshot=Readonly<{
 schemaVersion:1;runtimeId:string;configurationIdentity:string;
 providers:readonly Provider[];permissions:readonly string[];plugins:readonly Plugin[];
 providerPresent:boolean;unknownProviderFamily:boolean;
 completeness:'partial';verification:'unverifiable';reasons:readonly Reason[];digest:string;
}>;

export type EditorialAuthorizationObservationSource={
 runtimeId:string;
 access:{
  catalog():readonly string[];
  editorialProviderInventory():readonly ProviderObservation[];
  editorialScopeProvidersPresent():boolean;
 };
 registry:{
  catalog():readonly {id:string;configuredEnabled:boolean}[];
  getById(id:string):PluginDefinitionObservation;
  isInstalled(id:string):boolean;
  isEnabled(id:string):boolean;
 };
 /** Known registry entries to inspect even when list() hides them. */
 knownPluginIds?:readonly string[];
};

export class EditorialAuthorizationSnapshotError extends Error{
 constructor(readonly code:'editorial_snapshot_invalid'|'editorial_snapshot_integrity'|'editorial_snapshot_source_unavailable'){
  super(code);
  this.name='EditorialAuthorizationSnapshotError';
 }
}

function requireValid(condition:unknown):asserts condition{
 if(!condition)throw new EditorialAuthorizationSnapshotError('editorial_snapshot_invalid');
}
const logicalId=(value:unknown):value is string=>
 typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value)&&!value.includes('..');
function ids(values:readonly string[]):readonly string[]{
 requireValid(Array.isArray(values)&&Array.from(values).every(logicalId));
 return Object.freeze([...new Set(values)].sort());
}
const byId=(a:string,b:string)=>a<b?-1:a>b?1:0;

function build(runtimeId:string,observed:readonly ProviderObservation[],permissions:readonly string[],
 plugins:readonly Plugin[],providerPresent:boolean,unknownProviderFamily:boolean):EditorialAuthorizationSnapshot{
 requireValid(logicalId(runtimeId)&&Array.isArray(observed)&&Array.isArray(plugins));
 requireValid(typeof providerPresent==='boolean'&&typeof unknownProviderFamily==='boolean');
 const providerRows=new Map<string,Provider>();
 for(const row of observed){
  requireValid(row&&knownFamilies.has(row.family)&&!providerRows.has(row.family));
  requireValid(Number.isSafeInteger(row.count)&&row.count>=0&&!Object.is(row.count,-0));
  const providerIds=ids(row.ids===undefined?[]:row.ids);
  requireValid(providerIds.length<=row.count);
  providerRows.set(row.family,Object.freeze({family:row.family,count:row.count,ids:providerIds}));
 }
 const providers=Object.freeze([...providerRows.values()].sort((a,b)=>byId(a.family,b.family)));
 const pluginIds=new Set<string>();
 const pluginRows=Object.freeze(Array.from(plugins,plugin=>{
  requireValid(plugin&&logicalId(plugin.id)&&!pluginIds.has(plugin.id));
  requireValid(typeof plugin.version==='string'&&plugin.version.length<=160&&
   /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(plugin.version));
  requireValid(plugin.parentPlugin===null||logicalId(plugin.parentPlugin));
  requireValid(typeof plugin.installed==='boolean'&&typeof plugin.enabled==='boolean'&&(!plugin.enabled||plugin.installed));
  requireValid(plugin.configuredEnabled===null||typeof plugin.configuredEnabled==='boolean');
  requireValid(plugin.installed===(plugin.configuredEnabled!==null)&&(!plugin.enabled||plugin.configuredEnabled===true));
  pluginIds.add(plugin.id);
  return Object.freeze({id:plugin.id,version:plugin.version,dependencies:ids(plugin.dependencies),
   parentPlugin:plugin.parentPlugin,installed:plugin.installed,enabled:plugin.enabled,configuredEnabled:plugin.configuredEnabled});
 }).sort((a,b)=>byId(a.id,b.id)));
 const expected=runtimeId==='suinda'?[...commonFamilies,...suindaFamilies]:commonFamilies;
 const reasons:Reason[]=['live_sources_unsealed','plugin_inventory_partial'];
 if(expected.some(family=>!providerRows.has(family)))reasons.push('provider_inventory_partial');
 if(unknownProviderFamily||providers.some(row=>!expected.includes(row.family)))reasons.push('unknown_provider_family');
 const observedPresence=providers.some(row=>row.count>0);
 if(providerPresent||observedPresence||unknownProviderFamily)reasons.push('provider_not_homologated');
 if(!unknownProviderFamily&&observedPresence!==providerPresent)reasons.push('provider_detection_mismatch');
 const configuration={runtimeId,providers,permissions:ids(permissions),plugins:pluginRows,providerPresent,unknownProviderFamily};
 const body={schemaVersion:1 as const,...configuration,configurationIdentity:hashContextValue(configuration),
  completeness:'partial' as const,verification:'unverifiable' as const,reasons:Object.freeze(reasons.sort())};
 return Object.freeze({...body,digest:hashContextValue(body)});
}

/** Observe the current process. The seal protects the value, not the source or its lifetime. */
export function sealEditorialAuthorizationSnapshot(source:EditorialAuthorizationObservationSource):EditorialAuthorizationSnapshot{
 try{
  const inventory=source.access.editorialProviderInventory();
  requireValid(Array.isArray(inventory));
  const observed:ProviderObservation[]=[];
  let unknownProviderFamily=false;
  for(const row of inventory){
   requireValid(row&&typeof row.family==='string');
   if(knownFamilies.has(row.family))observed.push(row);else unknownProviderFamily=true;
  }
  const catalog=source.registry.catalog();
  requireValid(Array.isArray(catalog));
  const configured=new Map<string,boolean>();
  for(const plugin of catalog){
   requireValid(plugin&&logicalId(plugin.id)&&typeof plugin.configuredEnabled==='boolean'&&!configured.has(plugin.id));
   configured.set(plugin.id,plugin.configuredEnabled);
  }
  const plugins=ids([...ids(source.knownPluginIds===undefined?[]:source.knownPluginIds),...configured.keys()]).map(id=>{
   const plugin=source.registry.getById(id);
   requireValid(plugin&&plugin.id===id);
   return {id,version:plugin.version,dependencies:plugin.dependencies===undefined?[]:plugin.dependencies,
    parentPlugin:plugin.parentPlugin===undefined?null:plugin.parentPlugin,
    installed:source.registry.isInstalled(id),enabled:source.registry.isEnabled(id),configuredEnabled:configured.get(id)??null};
  });
  return build(source.runtimeId,observed,source.access.catalog(),plugins,
   source.access.editorialScopeProvidersPresent(),unknownProviderFamily);
 }catch(error){
  if(error instanceof EditorialAuthorizationSnapshotError)throw error;
  throw new EditorialAuthorizationSnapshotError('editorial_snapshot_source_unavailable');
 }
}

export function verifyEditorialAuthorizationSnapshot(value:unknown):EditorialAuthorizationSnapshot{
 try{
  const encoded=canonicalContextJson(value);
  const snapshot=JSON.parse(encoded) as EditorialAuthorizationSnapshot;
  requireValid(snapshot?.schemaVersion===1);
  const expected=build(snapshot.runtimeId,snapshot.providers,snapshot.permissions,snapshot.plugins,
   snapshot.providerPresent,snapshot.unknownProviderFamily);
  if(canonicalContextJson(expected)!==encoded)throw new EditorialAuthorizationSnapshotError('editorial_snapshot_integrity');
  return expected;
 }catch(error){
  if(error instanceof EditorialAuthorizationSnapshotError)throw error;
  throw new EditorialAuthorizationSnapshotError('editorial_snapshot_invalid');
 }
}

export function compareEditorialAuthorizationSnapshots(previous:unknown,current:unknown){
 const a=verifyEditorialAuthorizationSnapshot(previous);
 const b=verifyEditorialAuthorizationSnapshot(current);
 const fields=['runtimeId','providers','permissions','plugins','providerPresent','unknownProviderFamily','reasons'] as const;
 const changes=fields.filter(field=>canonicalContextJson(a[field])!==canonicalContextJson(b[field]));
 return {status:changes.length?'changed' as const:'unverifiable' as const,changes};
}
