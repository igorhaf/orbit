"use client";
import { useState } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Board,
  Card,
  ChecklistGroup,
  ChecklistItem,
  send,
} from "@/lib/api";
import { useConfirmModal } from "./ui";

type Props = {
  card: Card;
  board: Board;
  groups: ChecklistGroup[];
  mutate: (action: () => Promise<unknown>) => Promise<void>;
};

function Item({
  item,
  group,
  index,
  mutate,
}: {
  item: ChecklistItem;
  group: ChecklistGroup;
  index: number;
  mutate: Props["mutate"];
}) {
  const { confirm, confirmationModal } = useConfirmModal();
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: "item:" + item.id });
  const [text, setText] = useState(item.text);
  const path = "/checklist-items/" + item.id;
  const update = (body: Record<string, unknown>) =>
    void mutate(() => send(path, "PATCH", body));
  return (
    <>
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="rounded border border-[#dfe1e6] bg-white p-2 shadow-sm"
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Arrastar item"
          className="mt-1 cursor-grab text-[#626f86]"
        >
          <GripVertical size={15} />
        </button>
        <input
          type="checkbox"
          checked={item.completed}
          onChange={(event) => update({ completed: event.target.checked })}
          className="mt-1"
        />
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            if (text.trim() && text !== item.text) update({ text });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          maxLength={300}
          aria-label="Texto do item"
          className={`min-w-0 flex-1 bg-transparent text-sm outline-none ${item.completed ? "text-[#626f86] line-through" : ""}`}
        />
        <button
          type="button"
          title="Converter em cartão"
          onClick={() => confirm(
            { title: "Converter em cartão", description: "Converter este item em um cartão na mesma lista?", confirmLabel: "Converter", destructive: false },
            async () => { await mutate(() => send(path + "/convert", "POST", {})); },
          )}
          className="text-xs text-[#0c66e4]"
        >
          Cartão
        </button>
        <button
          type="button"
          title="Mover item para cima"
          disabled={index === 0}
          onClick={() => update({ position: index - 1 })}
          className="disabled:opacity-30"
        >
          <ArrowUp size={13} />
        </button>
        <button
          type="button"
          title="Mover item para baixo"
          disabled={index === group.items.length - 1}
          onClick={() => update({ position: index + 1 })}
          className="disabled:opacity-30"
        >
          <ArrowDown size={13} />
        </button>
        <button
          type="button"
          title="Excluir item"
          onClick={() => void mutate(() => send(path, "DELETE"))}
          className="text-[#ae2a19]"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
    {confirmationModal}
    </>
  );
}

function Group({
  group,
  mutate,
}: {
  group: ChecklistGroup;
  mutate: Props["mutate"];
}) {
  const [bulk, setBulk] = useState("");
  const progress = group.items.length
    ? Math.round(
        (group.items.filter((item) => item.completed).length /
          group.items.length) *
          100,
      )
    : 0;
  return (
    <div className="space-y-3">
      <div
        role="progressbar"
        aria-label="Progresso do checklist"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        className="h-2 overflow-hidden rounded bg-[#dfe1e6]"
      >
        <div
          className="h-full bg-[#4bce97]"
          style={{ width: progress + "%" }}
        />
      </div>
      <SortableContext
        items={group.items.map((item) => "item:" + item.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="mt-3 space-y-2">
          {group.items.map((item, itemIndex) => (
            <Item
              key={item.id + item.text}
              item={item}
              group={group}
              index={itemIndex}
              mutate={mutate}
            />
          ))}
        </div>
      </SortableContext>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!bulk.trim()) return;
          await mutate(() => send("/checklists/" + group.id + "/items", "POST", { text: bulk }));
          setBulk("");
        }}
        className="mt-3"
      >
        <textarea
          value={bulk}
          onChange={(event) => setBulk(event.target.value)}
          rows={2}
          placeholder="Adicionar item ou colar várias linhas"
          aria-label="Itens do checklist"
          className="w-full resize-y rounded border border-[#dfe1e6] bg-white p-2 text-sm"
        />
        <button
          disabled={!bulk.trim()}
          className="mt-1 flex items-center gap-1 rounded bg-[#e9eaed] px-2 py-1 text-xs font-semibold disabled:opacity-50"
        >
          <Plus size={13} /> Adicionar {bulk.includes("\n") ? "itens" : "item"}
        </button>
      </form>
    </div>
  );
}

export function CardChecklists({ card, groups, mutate }: Props) {
  const [items, setItems] = useState("");
  const checklistItems = groups[0]?.items ?? [];
  const progress = checklistItems.length
    ? Math.round(checklistItems.filter((item) => item.completed).length / checklistItems.length * 100)
    : 0;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  async function onDragEnd(event: DragEndEvent) {
    const active = String(event.active.id),
      over = String(event.over?.id || "");
    if (!over || active === over) return;
    if (!active.startsWith("item:")) return;
    const id = active.slice(5),
      sourceGroup = groups.find((group) =>
        group.items.some((item) => item.id === id),
      );
    const targetGroup = over.startsWith("group:")
      ? groups.find((group) => group.id === over.slice(6))
      : groups.find((group) =>
          group.items.some((item) => "item:" + item.id === over),
        );
    if (!sourceGroup || !targetGroup) return;
    const targetIndex = over.startsWith("group:")
      ? targetGroup.items.length
      : targetGroup.items.findIndex((item) => "item:" + item.id === over);
    await mutate(() =>
      send("/checklist-items/" + id, "PATCH", {
        checklist_id: targetGroup.id,
        position: targetIndex,
      }),
    );
  }
  return (
    <section id="card-checklists" aria-labelledby="card-checklist-heading">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 id="card-checklist-heading" className="flex items-center gap-2 font-semibold">
          <CheckSquare size={21} /> Checklist
        </h3>
        <span className="text-xs text-[#626f86]">{progress}%</span>
      </div>
      <div className="space-y-3 sm:pl-8">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(event) => void onDragEnd(event)}
        >
          {groups.slice(0, 1).map((group) => (
              <Group
                key={group.id + group.title}
                group={group}
                mutate={mutate}
              />
            ))}
        </DndContext>
        {!groups.length && <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!items.trim()) return;
            await mutate(async () => {
              const checklist = await send<{ id: string }>(
                "/cards/" + card.id + "/checklists",
                "POST",
                { title: "Checklist" },
              );
              return send("/checklists/" + checklist.id + "/items", "POST", {
                text: items,
              });
            });
            setItems("");
          }}
          className="space-y-2"
        >
          <textarea
            value={items}
            onChange={(event) => setItems(event.target.value)}
            rows={2}
            placeholder="Adicionar item ao checklist (uma linha por item)"
            aria-label="Itens do checklist"
            className="w-full resize-y rounded border border-[#dfe1e6] bg-white p-2 text-sm"
          />
          <button
            disabled={!items.trim()}
            className="flex items-center gap-1 rounded bg-[#e9eaed] px-2 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            <Plus size={13} /> Adicionar {items.includes("\n") ? "itens" : "item"}
          </button>
        </form>}
      </div>
    </section>
  );
}
