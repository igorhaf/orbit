/**
 * Test Page for Drag-and-Drop
 * Simplified test to verify react-beautiful-dnd is working
 */

'use client';

import { useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';

export default function TestDragPage() {
  const [items, setItems] = useState(['Item 1', 'Item 2', 'Item 3', 'Item 4']);

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const newItems = Array.from(items);
    const [removed] = newItems.splice(result.source.index, 1);
    newItems.splice(result.destination.index, 0, removed);

    setItems(newItems);
    console.log('Drag completed:', result);
  };

  return (
    <div className="p-8 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-2">Teste de Arrastar e Soltar</h1>
      <p className="text-gray-600 mb-6">
        Tente arrastar os itens abaixo. Verifique o console (F12) para erros.
      </p>

      <div className="mb-4 p-4 bg-blue-50 rounded">
        <p className="text-sm">
          <strong>Instrucoes:</strong>
        </p>
        <ol className="text-sm list-decimal list-inside space-y-1 mt-2">
          <li>Passe o mouse sobre um item - cursor deve mudar para "grab"</li>
          <li>Clique e segure - cursor deve mudar para "grabbing"</li>
          <li>Arraste para uma nova posicao</li>
          <li>Solte - o item deve mover</li>
          <li>Verifique o console para erros</li>
        </ol>
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="test-droppable">
          {(provided, snapshot) => (
            <div
              {...provided.droppableProps}
              ref={provided.innerRef}
              className={`bg-gray-100 p-4 rounded-lg min-h-[300px] transition-colors ${
                snapshot.isDraggingOver ? 'bg-blue-100 ring-2 ring-blue-300' : ''
              }`}
            >
              {items.map((item, index) => (
                <Draggable key={item} draggableId={item} index={index}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      className={`bg-white p-4 mb-2 rounded shadow cursor-grab active:cursor-grabbing transition-all ${
                        snapshot.isDragging ? 'opacity-50 rotate-2 scale-105 ring-2 ring-blue-400' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="text-gray-400">⋮⋮</div>
                        <span className="font-medium">{item}</span>
                      </div>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}

              {items.length === 0 && (
                <p className="text-gray-400 text-center py-8">Nenhum item</p>
              )}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      <div className="mt-6 p-4 bg-yellow-50 rounded">
        <p className="text-sm font-medium mb-2">Informacoes de Depuracao:</p>
        <ul className="text-xs space-y-1">
          <li>✓ DragDropContext: Initialized</li>
          <li>✓ Droppable: droppableId="test-droppable"</li>
          <li>✓ Draggable: {items.length} items</li>
          <li className="mt-2">
            <strong>If this works but Kanban doesn't:</strong> Issue is in Kanban structure
          </li>
          <li>
            <strong>If this doesn't work:</strong> Library or environment issue
          </li>
        </ul>
      </div>
    </div>
  );
}
