import {action, computed, observable, reaction} from 'mobx';

import {BindFileDocument} from '@sb/lib/editor/document/bind-file-document';
import {CollectionDocument} from '@sb/lib/editor/document/collection-document';
import {EditorDocument} from '@sb/lib/editor/document/editor-document';
import {TopologyDocument} from '@sb/lib/editor/document/topology-document';
import {DraftStorage} from '@sb/lib/editor/draft-storage';
import {CollectionStore} from '@sb/lib/stores/collection-store';
import {DeviceStore} from '@sb/lib/stores/device-store';
import {SchemaStore} from '@sb/lib/stores/schema-store';
import {TopologyStore} from '@sb/lib/stores/topology-store';
import {FetchState} from '@sb/types/types';

const TABS_STORAGE_PREFIX = 'sb:editor-tabs:';
const RECENT_STORAGE_PREFIX = 'sb:editor-recent:';

// How many recently opened files are kept
const RECENT_LIMIT = 8;

// A file the user opened, and when
export interface RecentFile {
  id: string;
  openedAt: number;
}

// What a file is called in lists, without opening it
export interface FileSummary {
  title: string;
  subtitle: string;
  icon: string;
}

interface StoredTabs {
  ids: string[];
  activeId: string | null;
  previewId: string | null;
}

/**
 * The open tabs of the editor, one document each. The open tabs are kept per
 * user in the local storage of the browser, together with the unsaved changes
 * of their documents.
 */
export class EditorTabStore {
  @observable.shallow accessor documents: EditorDocument[] = [];
  @observable accessor activeId: string | null = null;

  // The tab that is replaced by the next file opened as preview, e.g. by a single click
  @observable accessor previewId: string | null = null;

  // A file that was asked for but doesn't exist, e.g. by an old link; shown instead of the tabs until dismissed
  @observable accessor missingId: string | null = null;

  // The files the user opened last, newest first, also ones that were closed since
  @observable.shallow accessor recent: RecentFile[] = [];

  // The unsaved changes of the logged in user, set once the tabs are loaded
  private drafts: DraftStorage | null = null;
  private userId: string | null = null;
  private disposeReactions: (() => void)[] = [];

  constructor(
    // Only whether the user is logged in, the tabs are put away on logout
    private readonly dataBinder: {readonly isLoggedIn: boolean},
    private readonly topologyStore: TopologyStore,
    private readonly collectionStore: CollectionStore,
    private readonly deviceStore: DeviceStore,
    private readonly schemaStore: SchemaStore,
  ) {}

  @computed
  public get active(): EditorDocument | null {
    return this.find(this.activeId);
  }

  // The recently opened files that still exist
  @computed
  public get recentFiles(): RecentFile[] {
    return this.recent.filter(file => this.canOpen(file.id));
  }

  /**
   * The title, subtitle and icon of a topology, bind file or collection, like
   * its tab shows them, null if there is none with the ID.
   */
  public summary(id: string): FileSummary | null {
    const collection = this.collectionStore.lookup.get(id);
    if (collection) {
      return {
        title: collection.name,
        subtitle: 'Collection',
        icon: 'inventory_2',
      };
    }

    const topology = this.topologyStore.lookup.get(id);
    if (topology) {
      return {
        title: topology.definition.name ?? '',
        subtitle:
          this.collectionStore.lookup.get(topology.collectionId)?.name ?? '',
        icon: 'network_node',
      };
    }

    const bindFile = this.topologyStore.bindFileLookup.get(id);
    if (bindFile) {
      return {
        title: bindFile.filePath.split('/').pop() ?? '',
        subtitle:
          this.topologyStore.lookup.get(bindFile.topologyId)?.definition.name ??
          '',
        icon: 'description',
      };
    }

    return null;
  }

  public find(id: string | null): EditorDocument | null {
    return this.documents.find(document => document.id === id) ?? null;
  }

  public isOpen(id: string): boolean {
    return this.find(id) !== null;
  }

  /**
   * Sets up the tabs of a user, restores the tabs of their last visit. Called
   * once the topologies are loaded.
   */
  @action
  public load(userId: string) {
    if (this.userId === userId) return;

    this.reset();
    this.userId = userId;
    this.drafts = new DraftStorage(userId);

    this.recent = this.readRecent();
    this.missingId = null;

    const stored = this.readStored();
    for (const id of stored?.ids ?? []) {
      const document = this.createDocument(id);
      if (document) this.documents.push(document);
    }

    this.activeId = this.find(stored?.activeId ?? null)
      ? stored!.activeId
      : (this.documents[0]?.id ?? null);
    this.previewId = this.find(stored?.previewId ?? null)
      ? stored!.previewId
      : null;

    // Drafts of documents that aren't open anymore were closed somewhere else
    for (const id of this.drafts.documentIds()) {
      if (!this.isOpen(id)) this.drafts.delete(id);
    }

    this.disposeReactions = [
      // Tabs of deleted topologies and files are closed. The topologies are
      // only complete once they are loaded, e.g. they are all gone on logout.
      reaction(
        () =>
          this.topologyStore.fetchReport.state === FetchState.Done
            ? this.documents.filter(document => !this.canOpen(document.id))
            : [],
        deleted => deleted.forEach(document => this.remove(document.id)),
      ),

      // The tabs and their changes are kept for the next login of the user
      reaction(
        () => this.dataBinder.isLoggedIn,
        isLoggedIn => {
          if (!isLoggedIn) this.unload();
        },
      ),

      // A preview tab is kept once its file is changed
      reaction(
        () => this.find(this.previewId)?.isEdited ?? false,
        isEdited => {
          if (isEdited && this.previewId) this.pin(this.previewId);
        },
      ),
    ];

    this.persist();
  }

  /**
   * Opens a file in a tab, or shows its tab if it's already open.
   *
   * @param preview Opens the file in the preview tab, which the next preview
   * replaces unless the file is changed or opened again.
   */
  @action
  public open(id: string, preview = false): EditorDocument | null {
    if (!this.drafts) return null;

    const open = this.find(id);
    if (open) {
      if (!preview && this.previewId === id) this.previewId = null;
      this.show(id);
      this.persist();
      return open;
    }

    const document = this.createDocument(id);
    if (!document) {
      this.missingId = id;
      return null;
    }

    const replaced = preview ? this.find(this.previewId) : null;
    if (replaced && !replaced.isEdited) {
      const index = this.documents.indexOf(replaced);
      replaced.dispose();
      this.documents.splice(index, 1, document);
    } else {
      const index = this.documents.indexOf(this.active!);
      this.documents.splice(index + 1, 0, document);
    }

    this.previewId = preview ? id : this.previewId;
    this.show(id);
    this.persist();

    return document;
  }

  // Writes the unsaved changes that wait to be kept, e.g. before the page is left
  public flushDrafts() {
    this.drafts?.flush();
  }

  // Keeps a preview tab open, e.g. after it was changed
  @action
  public pin(id: string) {
    if (this.previewId !== id) return;

    this.previewId = null;
    this.persist();
  }

  /**
   * Closes a tab, its unsaved changes are discarded. The tab next to it is
   * shown if it was the shown one.
   */
  @action
  public close(id: string) {
    this.remove(id);
  }

  @action
  public activate(id: string) {
    if (!this.isOpen(id)) return;

    this.show(id);
    this.persist();
  }

  // Goes back to the tabs from a file that doesn't exist
  @action
  public dismissMissing() {
    this.missingId = null;
  }

  /**
   * Creates the document of a topology, bind file or collection, null if there
   * is none with the ID. The only place that tells the kinds of files apart.
   */
  private createDocument(id: string): EditorDocument | null {
    const collection = this.collectionStore.lookup.get(id);
    if (collection) {
      return new CollectionDocument(collection, this.collectionStore);
    }

    const topology = this.topologyStore.lookup.get(id);
    if (topology) {
      return new TopologyDocument(
        topology,
        this.topologyStore,
        this.collectionStore,
        this.deviceStore,
        this.schemaStore,
        this.drafts!,
      );
    }

    const bindFile = this.topologyStore.bindFileLookup.get(id);
    if (bindFile) {
      return new BindFileDocument(bindFile, this.topologyStore, this.drafts!);
    }

    return null;
  }

  // Shows an open tab and counts it as recently opened
  @action
  private show(id: string) {
    this.activeId = id;
    this.missingId = null;

    this.recent = [
      {id, openedAt: Date.now()},
      ...this.recent.filter(file => file.id !== id),
    ].slice(0, RECENT_LIMIT);
    this.write(RECENT_STORAGE_PREFIX, this.recent);
  }

  @action
  private remove(id: string) {
    const index = this.documents.findIndex(document => document.id === id);
    if (index < 0) return;

    const [document] = this.documents.splice(index, 1);
    document.dispose();
    this.drafts?.delete(id);

    if (this.previewId === id) this.previewId = null;
    if (this.activeId === id) {
      this.activeId =
        this.documents[Math.min(index, this.documents.length - 1)]?.id ?? null;
    }

    this.persist();
  }

  // Puts the tabs away without changing what's kept of them, load() restores them
  @action
  private unload() {
    this.drafts?.flush();
    this.reset();
    this.drafts = null;
    this.userId = null;
  }

  @action
  private reset() {
    this.disposeReactions.forEach(dispose => dispose());
    this.disposeReactions = [];
    this.documents.forEach(document => document.dispose());
    this.documents = [];
    this.activeId = null;
    this.previewId = null;
    this.missingId = null;
    this.recent = [];
  }

  /**
   * Whether there is a topology, bind file or collection with the ID. A bind
   * file is only there while its topology lists it, the lookup of the bind
   * files keeps deleted files until all topologies are loaded again.
   */
  public canOpen(id: string): boolean {
    if (this.topologyStore.lookup.has(id)) return true;
    if (this.collectionStore.lookup.has(id)) return true;

    const bindFile = this.topologyStore.bindFileLookup.get(id);
    if (!bindFile) return false;

    return !!this.topologyStore.lookup
      .get(bindFile.topologyId)
      ?.bindFiles.some(file => file.id === id);
  }

  private readStored(): StoredTabs | null {
    try {
      const stored = localStorage.getItem(TABS_STORAGE_PREFIX + this.userId);
      if (stored === null) return null;

      const tabs = JSON.parse(stored) as StoredTabs;
      return Array.isArray(tabs?.ids) ? tabs : null;
    } catch {
      return null;
    }
  }

  private readRecent(): RecentFile[] {
    try {
      const stored = localStorage.getItem(RECENT_STORAGE_PREFIX + this.userId);
      const recent = stored === null ? [] : (JSON.parse(stored) as unknown);
      if (!Array.isArray(recent)) return [];

      return recent.filter(
        (file): file is RecentFile =>
          typeof file?.id === 'string' && typeof file?.openedAt === 'number',
      );
    } catch {
      return [];
    }
  }

  private persist() {
    this.write(TABS_STORAGE_PREFIX, {
      ids: this.documents.map(document => document.id),
      activeId: this.activeId,
      previewId: this.previewId,
    } satisfies StoredTabs);
  }

  private write(prefix: string, value: unknown) {
    if (!this.userId) return;

    try {
      localStorage.setItem(prefix + this.userId, JSON.stringify(value));
    } catch {
      // Storage full or blocked: the tabs still work while the page is open
    }
  }
}
