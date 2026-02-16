/**
 * Test Page for @hello-pangea/dnd
 * Simple test to verify the module can be imported
 */

'use client';

import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

export default function TestDndPage() {
  const handleDragEnd = () => {
    console.log('Drag ended');
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Testando importação @hello-pangea/dnd</h1>

      <div className="space-y-4">
        <div className="bg-green-100 p-4 rounded">
          <p className="font-medium">Status de Importação do Módulo:</p>
          <ul className="mt-2 space-y-1">
            <li>DragDropContext: {DragDropContext ? '✅ Importado' : '❌ Falhou'}</li>
            <li>Droppable: {Droppable ? '✅ Importado' : '❌ Falhou'}</li>
            <li>Draggable: {Draggable ? '✅ Importado' : '❌ Falhou'}</li>
          </ul>
        </div>

        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="bg-blue-100 p-4 rounded">
            <p className="font-medium mb-2">Teste Simples de Arraste:</p>
            <Droppable droppableId="test">
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="bg-white p-4 rounded min-h-[100px]"
                >
                  <Draggable draggableId="item-1" index={0}>
                    {(provided) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                        className="bg-gray-200 p-3 rounded cursor-grab"
                      >
                        Arraste-me!
                      </div>
                    )}
                  </Draggable>
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
        </DragDropContext>

        <div className="bg-yellow-100 p-4 rounded">
          <p className="font-medium">Instruções:</p>
          <ol className="mt-2 space-y-1 list-decimal list-inside">
            <li>Se você ver ✅ para todas as importacoes, o módulo esta funcionando!</li>
            <li>Tente arrastar a caixa "Arraste-me!" acima</li>
            <li>Se funcionar aqui, o Kanban também deve funcionar</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
