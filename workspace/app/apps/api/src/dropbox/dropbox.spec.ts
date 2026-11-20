import assert from "node:assert/strict";
import test from "node:test";
import { PluginRegistry } from "../execution/registries";
import { DropboxPlugin, dropboxPluginDefinition } from "./dropbox.plugin";

test("Dropbox plugin exposes read and sharing actions", () => {
  const plugin = dropboxPluginDefinition({} as DropboxPlugin), registry = new PluginRegistry();
  registry.register(plugin);
  assert.deepEqual((plugin.actions || []).map(action => action.id), ["list_folder", "search_files", "get_metadata", "create_shared_link"]);
  assert.equal(registry.getAction("dropbox", "create_shared_link").requiredCapabilities?.[0], "sharing.write");
  assert.equal(plugin.connectionProvider?.id, "dropbox-oauth");
});
