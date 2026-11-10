import {runInAction} from 'mobx';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {BindFileDocument} from '@sb/lib/editor/document/bind-file-document';
import {CollectionDocument} from '@sb/lib/editor/document/collection-document';
import {TopologyDocument} from '@sb/lib/editor/document/topology-document';
import {DraftStorage} from '@sb/lib/editor/draft-storage';
import {EditorTabStore} from '@sb/lib/stores/editor-tab-store';
import {Topology} from '@sb/types/domain/topology';
import {FetchState} from '@sb/types/types';

import {
  ANNOTATIONS,
  createTopology,
  EditorTestBed,
  FakeTopologyStore,
  setUpEditorTest,
  tearDownEditorTest,
  TOPOLOGY,
} from '../editor/fakes';

let bed: EditorTestBed;
let topologyStore: FakeTopologyStore;
let drafts: DraftStorage;

beforeEach(() => {
  bed = setUpEditorTest();
  ({topologyStore, drafts} = bed);
});

afterEach(tearDownEditorTest);

const addTopology = (topology?: Topology) => bed.addTopology(topology);
const addBindFile = (content?: string) => bed.addBindFile(content);

describe('EditorTabStore', () => {
  let tabs: EditorTabStore;

  beforeEach(() => {
    addTopology();
    addTopology(createTopology(TOPOLOGY, ANNOTATIONS, 'other-id'));
    addBindFile();
    tabs = bed.tabStore();
    tabs.load('user-id');
  });

  it('opens a topology and a bind file in their own tabs', () => {
    tabs.open('topology-id');
    tabs.open('file-id');

    expect(tabs.documents.map(document => document.id)).toEqual([
      'topology-id',
      'file-id',
    ]);
    expect(tabs.active!.id).toBe('file-id');
    expect(tabs.documents[0]).toBeInstanceOf(TopologyDocument);
    expect(tabs.documents[1]).toBeInstanceOf(BindFileDocument);
  });

  it('shows the tab of a file that is already open', () => {
    const first = tabs.open('topology-id');
    tabs.open('file-id');
    const again = tabs.open('topology-id');

    expect(again).toBe(first);
    expect(tabs.documents).toHaveLength(2);
    expect(tabs.active).toBe(first);
  });

  it('replaces the preview tab with the next preview', () => {
    tabs.open('topology-id', true);
    tabs.open('other-id', true);

    expect(tabs.documents.map(document => document.id)).toEqual(['other-id']);
  });

  it('keeps a preview tab with changes', () => {
    const preview = tabs.open('topology-id', true)!;
    preview.graph!.renameNode('pc', 'client');
    tabs.open('other-id', true);

    expect(tabs.documents.map(document => document.id)).toEqual([
      'topology-id',
      'other-id',
    ]);
  });

  it('keeps a preview tab that is opened again', () => {
    tabs.open('topology-id', true);
    tabs.open('topology-id');
    tabs.open('other-id', true);

    expect(tabs.documents).toHaveLength(2);
  });

  it('shows the tab next to a closed tab and discards its changes', () => {
    tabs.open('topology-id');
    tabs.open('other-id');
    tabs.find('other-id')!.graph!.renameNode('pc', 'client');
    vi.runOnlyPendingTimers();
    tabs.close('other-id');

    expect(tabs.active!.id).toBe('topology-id');
    expect(drafts.load('other-id')).toBeNull();
  });

  it('restores the tabs and their changes after a reload', () => {
    tabs.open('topology-id');
    tabs.open('file-id');
    tabs.find('topology-id')!.graph!.renameNode('pc', 'client');
    vi.runOnlyPendingTimers();

    const reloaded = bed.tabStore();
    reloaded.load('user-id');

    expect(reloaded.documents.map(document => document.id)).toEqual([
      'topology-id',
      'file-id',
    ]);
    expect(reloaded.active!.id).toBe('file-id');
    expect(reloaded.find('topology-id')!.isEdited).toBe(true);
  });

  it('closes the tab of a deleted topology', () => {
    tabs.open('topology-id');
    tabs.open('other-id');
    runInAction(() => topologyStore.lookup.delete('other-id'));

    expect(tabs.documents.map(document => document.id)).toEqual([
      'topology-id',
    ]);
    expect(tabs.active!.id).toBe('topology-id');
  });

  it('closes the tab of a deleted bind file', () => {
    tabs.open('topology-id');
    tabs.open('file-id');

    // Fetching the topology again doesn't remove the file from the lookup
    runInAction(
      () => (topologyStore.lookup.get('topology-id')!.bindFiles = []),
    );

    expect(tabs.documents.map(document => document.id)).toEqual([
      'topology-id',
    ]);
    expect(tabs.canOpen('file-id')).toBe(false);
  });

  it('keeps the tabs and their changes on logout', () => {
    tabs.open('topology-id');
    tabs.open('file-id');
    tabs.find('topology-id')!.graph!.renameNode('pc', 'client');

    // Like the topology store and the data binder on logout
    runInAction(() => {
      topologyStore.lookup.clear();
      topologyStore.bindFileLookup.clear();
      topologyStore.fetchReport.state = FetchState.Pending;
    });
    runInAction(() => (bed.dataBinder.isLoggedIn = false));

    expect(tabs.documents).toHaveLength(0);

    // Logging in again loads the topologies and the tabs again
    runInAction(() => {
      bed.dataBinder.isLoggedIn = true;
      addTopology();
      addTopology(createTopology(TOPOLOGY, ANNOTATIONS, 'other-id'));
      addBindFile();
      topologyStore.fetchReport.state = FetchState.Done;
    });
    tabs.load('user-id');

    expect(tabs.documents.map(document => document.id)).toEqual([
      'topology-id',
      'file-id',
    ]);
    expect(tabs.find('topology-id')!.isEdited).toBe(true);
  });

  it('opens nothing for an unknown ID', () => {
    expect(tabs.open('unknown')).toBeNull();
    expect(tabs.documents).toHaveLength(0);
  });

  it('shows an unknown ID as missing instead of the open tab', () => {
    tabs.open('topology-id');
    tabs.open('unknown');

    expect(tabs.missingId).toBe('unknown');
    expect(tabs.activeId).toBe('topology-id');

    tabs.dismissMissing();
    expect(tabs.missingId).toBeNull();
  });

  it('goes back to the tabs when one is shown', () => {
    tabs.open('topology-id');
    tabs.open('unknown');
    tabs.activate('topology-id');

    expect(tabs.missingId).toBeNull();
  });

  it('keeps the files that were opened last, newest first', () => {
    tabs.open('topology-id');
    tabs.open('file-id');
    tabs.activate('topology-id');
    tabs.close('file-id');

    expect(tabs.recentFiles.map(file => file.id)).toEqual([
      'topology-id',
      'file-id',
    ]);

    const reloaded = bed.tabStore();
    reloaded.load('user-id');
    expect(reloaded.recentFiles.map(file => file.id)).toEqual([
      'topology-id',
      'file-id',
    ]);
  });

  it('leaves deleted files out of the recently opened ones', () => {
    tabs.open('other-id');
    tabs.close('other-id');
    runInAction(() => topologyStore.lookup.delete('other-id'));

    expect(tabs.recentFiles).toEqual([]);
  });

  it('opens a collection as an overview without files', () => {
    const collection = tabs.open('collection-id')!;

    expect(collection).toBeInstanceOf(CollectionDocument);
    expect(collection.title).toBe('collection');
    expect(collection.capabilities.views).toEqual(['overview']);
    expect(collection.files).toEqual([]);
    expect(collection.activeFile).toBeNull();
    expect(collection.isEdited).toBe(false);
  });

  it('closes the tab of a deleted collection', () => {
    tabs.open('topology-id');
    tabs.open('collection-id');
    runInAction(() => bed.collectionStore.lookup.delete('collection-id'));

    expect(tabs.documents.map(document => document.id)).toEqual([
      'topology-id',
    ]);
  });

  it('names topologies and bind files like their tabs', () => {
    expect(tabs.summary('topology-id')).toEqual({
      title: 'test',
      subtitle: 'collection',
      icon: 'network_node',
    });
    expect(tabs.summary('file-id')).toEqual({
      title: 'r1.cfg',
      subtitle: 'test',
      icon: 'description',
    });
    expect(tabs.summary('collection-id')).toEqual({
      title: 'collection',
      subtitle: 'Collection',
      icon: 'inventory_2',
    });
    expect(tabs.summary('unknown')).toBeNull();
  });
});
