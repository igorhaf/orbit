import {recordCardsPlugin} from "../apps/api/src/plugins/record-cards/record-cards.plugin";
import { structuredViewPlugin } from "../apps/api/src/plugins/board-views/board-view.plugins";
import { processBoardPlugin } from "../apps/api/src/plugins/process-board/process-board.plugin";
import "reflect-metadata";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Db } from "../apps/api/src/db";
import { AccessService } from "../apps/api/src/access/access";
import { PluginRegistry } from "../apps/api/src/execution/registries";
import { WorkspacesService, workspacesPlugin } from "../apps/api/src/workspaces/workspaces.plugin";
import { genericPlugins } from "../apps/api/src/plugins/records/catalog";
import { ExtensionRecords } from "../apps/api/src/plugins/records/records.service";
import { DocumentScanner } from "../apps/api/src/plugins/records/documents";
import { safdoulasPlugins } from "../apps/api/src/safdoulas/suite";
import { safdoulasReferenceData } from "../apps/api/src/safdoulas/reference-data";
import { bootstrapSafdoulas } from "../apps/api/src/safdoulas/bootstrap";
import { migrateVersions } from "../apps/api/src/migrations";

async function main() {
  const database = new URL(process.env.DATABASE_URL || "");
  if (database.pathname !== "/safdoulas" && !database.pathname.startsWith("/orbit_restore_tests_"))
    throw new Error("A preparação é exclusiva do banco safdoulas ou de um banco descartável de teste.");
  const directory = process.argv[2];
  if (!directory) throw new Error("Informe a pasta dos 13 documentos originais.");
  const sources = await Promise.all(safdoulasReferenceData.sources.map(async (source) => ({ file_name: source.file_name, data: await readFile(join(directory, source.file_name)) })));
  const db = new Db();
  try {
    await migrateVersions(db.pool);
    const root = await db.one<{ id: string }>("SELECT id FROM users WHERE is_root=true AND disabled=false ORDER BY created_at LIMIT 1");
    if (!root) throw new Error("Nenhuma conta root ativa foi encontrada.");
    const plugins = new PluginRegistry();
    for (const plugin of [workspacesPlugin, structuredViewPlugin, processBoardPlugin, recordCardsPlugin, ...genericPlugins, ...safdoulasPlugins]) plugins.register(plugin);
    for (const setting of await db.query<{ plugin_id: string; enabled: boolean }>("SELECT plugin_id,enabled FROM plugin_settings"))
      if (plugins.list().some((plugin) => plugin.id === setting.plugin_id)) plugins.setEnabled(setting.plugin_id, setting.enabled);
    const access = new AccessService(db); access.registerPlugins(plugins.list());
    const spaces = new WorkspacesService(db, access); spaces.onModuleInit();
    const records = new ExtensionRecords(db, access, plugins, new DocumentScanner()); records.onModuleInit();
    const prior = await db.one<{ id: string }>("SELECT id FROM workspaces WHERE name='SafDoulas — Acreditação' AND archived_at IS NULL LIMIT 1");
    const workspace = prior || await spaces.create(root.id, { name: "SafDoulas — Acreditação" });
    console.log(JSON.stringify(await bootstrapSafdoulas(db, records, String(workspace.id), root.id, sources), null, 2));
  } finally { await db.pool.end(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Falha na preparação."); process.exitCode = 1; });
