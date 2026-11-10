import {definePlugin} from '../sdk';

export const visualBoardPlugin=definePlugin({
  id:'board-view',name:'Quadro visual',version:'1.0.0',
  description:'Visualização de quadros em colunas e cartões.',
  contributions:{boardViews:[{id:'board',name:'Quadro visual',renderer:'board',permission:'views.board.use'}]},
});
export const structuredViewPlugin=definePlugin({
  id:'structured-view',name:'Gestão estruturada',version:'1.0.0',
  description:'Lista de demandas, filtros salvos, hierarquia de contextos e detalhes em modal centralizado.',
  contributions:{boardViews:[{id:'structured',name:'Gestão estruturada',renderer:'structured',permission:'views.structured.use'}]},
});
