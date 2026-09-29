import { comparer, observable, reaction, runInAction } from 'mobx';
import { afterEach, describe, expect, it } from 'vitest';
import { createTabRegistry } from './core/tab-provider-registry';
import { PaneLayoutStore } from './pane-layout-store';
import type {
  PaneLayoutSnapshotDocument,
  PaneLayoutSnapshotMemento,
  PersistedTabDescriptor,
} from './persistence';

const stores: PaneLayoutStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
});

/** A memento backed by one observable document, like the shared server row. */
function fakeMemento(initial: PaneLayoutSnapshotDocument | null) {
  const doc = observable.box<PaneLayoutSnapshotDocument | null>(initial, { deep: false });
  const memento: PaneLayoutSnapshotMemento = {
    ready: Promise.resolve(),
    get hasStoredValue() {
      return doc.get() !== null;
    },
    read: () =>
      doc.get() ?? {
        version: '2',
        activeGroupId: 'default',
        groups: [{ groupId: 'default', tabManager: { tabs: [] } }],
      },
    autoPersist: (read) =>
      reaction(read, (value) => runInAction(() => doc.set(value)), {
        equals: comparer.structural,
      }),
  };
  /** Simulates another device saving its layout. */
  const writeRemote = (next: PaneLayoutSnapshotDocument) => runInAction(() => doc.set(next));
  return { memento, doc, writeRemote };
}

function tab(id: string, tabId = `tab-${id}`): PersistedTabDescriptor {
  return { kind: 'test', tabId, isPreview: false, id };
}

function docWith(tabs: PersistedTabDescriptor[], activeTabId?: string): PaneLayoutSnapshotDocument {
  return {
    version: '2',
    activeGroupId: 'g1',
    groups: [{ groupId: 'g1', tabManager: { tabs, activeTabId } }],
  };
}

async function setup(initial: PaneLayoutSnapshotDocument) {
  const registry = createTabRegistry([
    {
      kind: 'test',
      resourceKey: (state: { id: string }) => state.id,
      initialize: () => ({ dispose() {} }),
      dispose() {},
      TabBarItem: () => null,
      TabBarItemDragPreview: () => null,
      TabContent: () => null,
    },
  ]);
  const { memento, doc, writeRemote } = fakeMemento(initial);
  const store = new PaneLayoutStore(registry, { viewId: 'task' }, memento);
  stores.push(store);
  await store.hydrate();
  store.startPersistence();
  const openTabIds = () => store.groups.flatMap((g) => g.pane.tabOrder);
  return { store, doc, writeRemote, openTabIds };
}

describe('pane layout sync across devices', () => {
  it('shows a tab opened on another device without switching the active tab', async () => {
    const { store, writeRemote, openTabIds } = await setup(docWith([tab('a')], 'tab-a'));

    writeRemote(docWith([tab('a'), tab('b')], 'tab-b'));

    expect(openTabIds()).toEqual(['tab-a', 'tab-b']);
    expect(store.focusedPane.activeTabId).toBe('tab-a');
  });

  it('closes a tab that another device closed', async () => {
    const { writeRemote, openTabIds } = await setup(docWith([tab('a'), tab('b')], 'tab-a'));

    writeRemote(docWith([tab('a')], 'tab-a'));

    expect(openTabIds()).toEqual(['tab-a']);
  });

  it('keeps a tab opened locally and publishes it for the other device', async () => {
    const { store, doc, openTabIds } = await setup(docWith([tab('a')], 'tab-a'));

    store.open('test' as never, { id: 'local' } as never);

    expect(openTabIds()).toHaveLength(2);
    expect(doc.get()?.groups[0].tabManager.tabs.map((t) => t.id)).toEqual(['a', 'local']);
  });

  it('shows a resource once when the other device reopened it under a new tab id', async () => {
    const { writeRemote, openTabIds } = await setup(docWith([tab('a')], 'tab-a'));

    writeRemote(docWith([tab('a', 'other-device-tab')]));

    expect(openTabIds()).toEqual(['other-device-tab']);
  });

  it('does not duplicate a resource opened on both devices before they synced', async () => {
    const { store, writeRemote, openTabIds } = await setup(docWith([tab('a')], 'tab-a'));
    store.stopPersistence();
    store.open('test' as never, { id: 'b' } as never);

    writeRemote(docWith([tab('a'), tab('b', 'other-device-b')], 'tab-a'));
    store.startPersistence();

    expect(openTabIds().filter((id) => id !== 'tab-a')).toHaveLength(1);
  });

  it('catches up on changes made while the task view was suspended', async () => {
    const { store, writeRemote, openTabIds } = await setup(docWith([tab('a'), tab('b')], 'tab-a'));

    store.stopPersistence();
    writeRemote(docWith([tab('a'), tab('c')], 'tab-a'));
    expect(openTabIds()).toEqual(['tab-a', 'tab-b']);
    store.startPersistence();

    expect(openTabIds()).toEqual(['tab-a', 'tab-c']);
  });
});
