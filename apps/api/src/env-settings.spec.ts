import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EnvironmentSettingsController} from './env-settings';
import {PluginRegistry} from './execution/registries';
import {publicApiUrl} from './public-api-url';
import {googleRedirectUri} from './google/redirect-uri';

test('OAuth base URL follows the API port and honors a public override',()=>{
  const previous={url:process.env.API_PUBLIC_URL,port:process.env.API_PORT};
  try{
    delete process.env.API_PUBLIC_URL;
    process.env.API_PORT='4001';
    assert.equal(publicApiUrl(),'http://localhost:4001');
    process.env.API_PUBLIC_URL='https://orbit.example.test/api/';
    assert.equal(publicApiUrl(),'https://orbit.example.test/api');
  }finally{
    if(previous.url===undefined)delete process.env.API_PUBLIC_URL;else process.env.API_PUBLIC_URL=previous.url;
    if(previous.port===undefined)delete process.env.API_PORT;else process.env.API_PORT=previous.port;
  }
});

test('Google plugins expose the same redirect URIs sent during OAuth',()=>{
  const previous={url:process.env.API_PUBLIC_URL,port:process.env.API_PORT,drive:process.env.GOOGLE_DRIVE_REDIRECT_URI};
  try{
    delete process.env.API_PUBLIC_URL;
    delete process.env.GOOGLE_DRIVE_REDIRECT_URI;
    process.env.API_PORT='4001';
    assert.equal(googleRedirectUri('drive'),'http://localhost:4001/google/drive/oauth/callback');
    process.env.GOOGLE_DRIVE_REDIRECT_URI='https://orbit.example.test/google/drive/oauth/callback';
    assert.equal(googleRedirectUri('drive'),'https://orbit.example.test/google/drive/oauth/callback');
  }finally{
    if(previous.url===undefined)delete process.env.API_PUBLIC_URL;else process.env.API_PUBLIC_URL=previous.url;
    if(previous.port===undefined)delete process.env.API_PORT;else process.env.API_PORT=previous.port;
    if(previous.drive===undefined)delete process.env.GOOGLE_DRIVE_REDIRECT_URI;else process.env.GOOGLE_DRIVE_REDIRECT_URI=previous.drive;
  }
});

test('core and plugin environment settings have separate ownership',async()=>{
  const registry=new PluginRegistry();
  registry.register({id:'fixture_plugin',name:'Fixture',version:'1.0.0',configuration:[{key:'ORBIT_TEST_PLUGIN_ONLY_TOKEN',label:'Token',secret:true}]});
  const controller=new EnvironmentSettingsController({user:()=> 'owner'} as never,registry);
  const previous=process.env.ORBIT_TEST_PLUGIN_ONLY_TOKEN;
  process.env.ORBIT_TEST_PLUGIN_ONLY_TOKEN='hidden-token';
  try{
    const core=await controller.list({} as never);
    assert(core.groups.some(group=>group.fields.some(field=>field.key==='GOOGLE_CLIENT_ID')));
    assert.equal(core.groups.flatMap(group=>group.fields).find(field=>field.key==='GOOGLE_CLIENT_SECRET')?.value,'');
    assert(core.groups.every(group=>group.fields.every(field=>field.key!=='ORBIT_TEST_PLUGIN_ONLY_TOKEN'&&field.key!=='DROPBOX_CLIENT_SECRET')));
    const plugin=await controller.pluginSettings({} as never,'fixture_plugin');
    assert.deepEqual(plugin.fields.map(field=>field.key),['ORBIT_TEST_PLUGIN_ONLY_TOKEN']);
    assert.equal(plugin.fields[0].configured,true);
    assert.equal(plugin.fields[0].value,'');
    await assert.rejects(()=>controller.update({} as never,{values:{ORBIT_TEST_PLUGIN_ONLY_TOKEN:'new'},clear:[]}),/Configuração inválida/);
    await assert.rejects(()=>controller.updatePlugin({} as never,'fixture_plugin',{values:{GOOGLE_CLIENT_ID:'new'},clear:[]}),/Configuração inválida/);
    assert.equal(registry.catalog()[0].configurable,true);
    assert.equal(JSON.stringify(registry.catalog()).includes('ORBIT_TEST_PLUGIN_ONLY_TOKEN'),false);
  }finally{if(previous===undefined)delete process.env.ORBIT_TEST_PLUGIN_ONLY_TOKEN;else process.env.ORBIT_TEST_PLUGIN_ONLY_TOKEN=previous}
});
