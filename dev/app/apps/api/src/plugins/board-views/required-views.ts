export const REQUIRED_BOARD_VIEW_PLUGIN_IDS=['board-view','structured-view'] as const;

export function hasBoardViewAfterChange(current:ReadonlyMap<string,boolean>,pluginId:string,nextEnabled:boolean){
  return REQUIRED_BOARD_VIEW_PLUGIN_IDS.some(id=>id===pluginId?nextEnabled:(current.get(id)??true));
}
