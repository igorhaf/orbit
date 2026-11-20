import test from 'node:test';
import assert from 'node:assert/strict';
import { watchNavigationHeading } from './navigation-announcer';

class FakeClock {
  private nextId = 1;
  private timers = new Map<number, () => void>();

  setTimeout = (callback: () => void) => {
    const id = this.nextId++;
    this.timers.set(id, callback);
    return id;
  };

  clearTimeout = (id: number) => {
    this.timers.delete(id);
  };

  advance() {
    const pending = [...this.timers.values()];
    this.timers.clear();
    pending.forEach((callback) => callback());
  }
}

class FakeObserver {
  static instances: FakeObserver[] = [];
  disconnected = false;
  callback: MutationCallback;

  constructor(callback: MutationCallback) {
    this.callback = callback;
    FakeObserver.instances.push(this);
  }

  observe() {}
  disconnect() { this.disconnected = true; }
  trigger() { this.callback([], this as unknown as MutationObserver); }
}

function environment() {
  const clock = new FakeClock();
  let heading: { innerText: string } | null = null;
  const doc = {
    body: {} as Node,
    querySelector: () => heading as unknown as HTMLElement | null,
    setHeading: (value: string | null) => { heading = value ? { innerText: value } : null; },
  };
  const view = {
    setTimeout: clock.setTimeout as unknown as Window['setTimeout'],
    clearTimeout: clock.clearTimeout as unknown as Window['clearTimeout'],
  };
  return {
    clock,
    doc,
    env: {
      document: doc as unknown as Pick<Document, 'body' | 'querySelector'>,
      window: view as Pick<Window, 'setTimeout' | 'clearTimeout'>,
      MutationObserver: FakeObserver as unknown as typeof MutationObserver,
    },
  };
}

test('announces a heading inserted after the initial lookup and disconnects its observer', () => {
  FakeObserver.instances = [];
  const { clock, doc, env } = environment();
  const published: Array<[string, string]> = [];
  const cleanup = watchNavigationHeading('/suinda/learning/123', () => true, (announcement, title) => {
    published.push([announcement, title]);
  }, 'Suindá', env);

  clock.advance();
  assert.equal(FakeObserver.instances.length, 1);
  doc.setHeading('Fundamentos de Anatomia');
  FakeObserver.instances[0].trigger();

  assert.deepEqual(published, [['Página: Fundamentos de Anatomia', 'Fundamentos de Anatomia | Suindá']]);
  assert.equal(FakeObserver.instances[0].disconnected, true);
  cleanup();
});

test('cancels a pending route heading before the next route can announce its own heading', () => {
  FakeObserver.instances = [];
  const { clock, doc, env } = environment();
  const published: Array<[string, string]> = [];
  let currentPath = '/suinda/learning/old';
  const publish = (announcement: string, title: string) => published.push([announcement, title]);

  const cleanupOldRoute = watchNavigationHeading('/suinda/learning/old', () => currentPath === '/suinda/learning/old', publish, 'Suindá', env);
  clock.advance();
  const oldObserver = FakeObserver.instances[0];

  currentPath = '/suinda/learning/new';
  cleanupOldRoute();
  doc.setHeading('Título atrasado da rota anterior');
  oldObserver.trigger();
  assert.deepEqual(published, []);
  assert.equal(oldObserver.disconnected, true);

  doc.setHeading(null);
  const cleanupNewRoute = watchNavigationHeading('/suinda/learning/new', () => currentPath === '/suinda/learning/new', publish, 'Suindá', env);
  clock.advance();
  doc.setHeading('Curso atual');
  FakeObserver.instances[1].trigger();

  assert.deepEqual(published, [['Página: Curso atual', 'Curso atual | Suindá']]);
  assert.equal(FakeObserver.instances[1].disconnected, true);
  cleanupNewRoute();
});

test('clears the initial listener when the pathname changes before observation begins', () => {
  FakeObserver.instances = [];
  const { clock, env } = environment();
  const published: Array<[string, string]> = [];
  const cleanup = watchNavigationHeading('/boards', () => false, (announcement, title) => {
    published.push([announcement, title]);
  }, 'Orbit', env);

  cleanup();
  clock.advance();

  assert.equal(FakeObserver.instances.length, 0);
  assert.deepEqual(published, []);
});
