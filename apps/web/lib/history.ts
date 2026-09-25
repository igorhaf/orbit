import { send } from './api';

type Operation = { path: string; method: 'PATCH' | 'POST' | 'DELETE'; body?: unknown };
type Entry = { label: string; undo: Operation[]; redo: Operation[] };
const undoStack: Entry[] = [];
const redoStack: Entry[] = [];
let running = false;
const notify = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('history:changed'));
};
export const historyState = () => ({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, undoLabel: undoStack.at(-1)?.label, redoLabel: redoStack.at(-1)?.label });
export function remember(entry: Entry) {
  if (running) return;
  undoStack.push(entry);
  if (undoStack.length > 30) undoStack.shift();
  redoStack.length = 0;
  notify();
}
async function perform(steps: Operation[]) {
  for (const step of steps) await send(step.path,step.method,step.body);
  window.dispatchEvent(new Event('data:changed'));
}
export async function undo() {
  if (running || !undoStack.length) return;
  running = true;
  const entry = undoStack.pop()!;
  try { await perform(entry.undo); redoStack.push(entry); }
  catch (error) { undoStack.push(entry); throw error; }
  finally { running = false; notify(); }
}
export async function redo() {
  if (running || !redoStack.length) return;
  running = true;
  const entry = redoStack.pop()!;
  try { await perform(entry.redo); undoStack.push(entry); }
  catch (error) { redoStack.push(entry); throw error; }
  finally { running = false; notify(); }
}
