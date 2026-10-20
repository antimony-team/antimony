import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {DataBinder} from '@sb/lib/stores/data-binder/data-binder';
import {ShellStore} from '@sb/lib/stores/shell-store';
import {StatusMessageStore} from '@sb/lib/stores/status-message-store';
import {
  Lab,
  RuntimeCommand,
  ShellCommand,
  ShellData,
} from '@sb/types/domain/lab';
import {ErrorCodes} from '@sb/types/error-codes';

type Callback = (data: unknown) => void;

const FORBIDDEN = {
  code: ErrorCodes.ErrorSocketForbidden,
  message: 'Forbidden',
};

class FakeDataBinder {
  public callbacks = new Map<string, Callback>();
  public onConnect = new Map<string, () => void>();
  public emitted: Record<string, unknown>[] = [];
  public sent: string[] = [];
  public ack: unknown = {payload: null};

  public subscribeNamespace(
    namespace: string,
    onData?: Callback,
    onConnect?: () => void,
  ) {
    if (onData) this.callbacks.set(namespace, onData);
    if (onConnect) this.onConnect.set(namespace, onConnect);

    return {
      namespace,
      socket: {
        emit: (_event: string, data: string) => this.sent.push(data),
        emitWithAck: async (_event: string, data: string) => {
          this.emitted.push(JSON.parse(data));
          return this.ack;
        },
      },
    };
  }

  public unsubscribeNamespace(namespace: string) {
    this.callbacks.delete(namespace);
    this.onConnect.delete(namespace);
  }
}

function lab(id: string): Lab {
  return {id, instance: {}} as Lab;
}

function shell(id: string, expired = false): ShellData {
  return {id, node: 'r1', expired};
}

describe('ShellStore', () => {
  let dataBinder: FakeDataBinder;
  let statusMessageStore: {error: (message: string, title: string) => void};
  let store: ShellStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    dataBinder = new FakeDataBinder();
    statusMessageStore = {error: vi.fn()};
    store = new ShellStore(
      dataBinder as unknown as DataBinder,
      statusMessageStore as unknown as StatusMessageStore,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function openShell(labId: string, id: string) {
    dataBinder.ack = {payload: id};
    const opened = await store.openShell(lab(labId), 'r1');
    dataBinder.emitted = [];
    return opened!;
  }

  function control(command: ShellCommand, labId: string, shellId: string) {
    dataBinder.callbacks.get('shell-control')!({
      payload: {labId, node: 'r1', shellId, command, message: ''},
    });
  }

  describe('opening', () => {
    it('opens a shell with the size of the terminal', async () => {
      store.terminalSize = {cols: 120, rows: 40};
      dataBinder.ack = {payload: 's1'};

      const opened = await store.openShell(lab('a'), 'r1');
      expect(opened).toEqual(shell('s1'));
      expect(store.getShellsForLab('a')).toEqual([shell('s1')]);
      expect(dataBinder.emitted).toEqual([
        {
          labId: 'a',
          node: 'r1',
          command: RuntimeCommand.OpenShell,
          cols: 120,
          rows: 40,
        },
      ]);
    });

    it('reports when the shell limit is reached', async () => {
      dataBinder.ack = {
        code: ErrorCodes.ErrorShellLimitReached,
        message: 'Limit',
      };

      expect(await store.openShell(lab('a'), 'r1')).toBeNull();
      expect(statusMessageStore.error).toHaveBeenCalledWith(
        'Shell limit reached',
        'Failed to open new shell',
      );
      expect(store.getShellsForLab('a')).toEqual([]);
    });

    it('reports the error of the server if opening a shell fails', async () => {
      dataBinder.ack = FORBIDDEN;

      expect(await store.openShell(lab('a'), 'r1')).toBeNull();
      expect(statusMessageStore.error).toHaveBeenCalledWith(
        'Forbidden',
        'Failed to open new shell',
      );
      expect(store.getShellsForLab('a')).toEqual([]);
    });
  });

  describe('closing', () => {
    it('removes the shell and tells the server to close it shortly after', async () => {
      await openShell('a', 's1');
      await openShell('a', 's2');

      await store.closeShell(lab('a'), 's1');
      expect(store.getShellsForLab('a')).toEqual([shell('s2')]);
      expect(dataBinder.emitted).toEqual([]);

      await vi.advanceTimersByTimeAsync(20);
      expect(dataBinder.emitted).toEqual([
        {labId: 'a', shellId: 's1', command: RuntimeCommand.CloseShell},
      ]);
    });

    it('ignores shells it does not know', async () => {
      await openShell('a', 's1');

      await store.closeShell(lab('a'), 'other');
      await store.closeShell(lab('b'), 's1');
      await vi.advanceTimersByTimeAsync(20);

      expect(store.getShellsForLab('a')).toEqual([shell('s1')]);
      expect(dataBinder.emitted).toEqual([]);
    });

    it('keeps the other shells if the server forbids closing a shell', async () => {
      await openShell('a', 's1');
      await openShell('a', 's2');
      dataBinder.ack = FORBIDDEN;

      await store.closeShell(lab('a'), 's1');
      await vi.advanceTimersByTimeAsync(20);

      expect(store.getShellsForLab('a')).toEqual([shell('s2')]);
    });

    // Bug: closeShell ignores the answer of the server
    it.fails('reports if the server forbids closing a shell', async () => {
      await openShell('a', 's1');
      dataBinder.ack = FORBIDDEN;

      await store.closeShell(lab('a'), 's1');
      await vi.advanceTimersByTimeAsync(20);

      expect(statusMessageStore.error).toHaveBeenCalled();
    });
  });

  describe('resizing', () => {
    it('sends the size of the terminal', async () => {
      store.terminalSize = {cols: 100, rows: 30};

      await store.resizeShell(shell('s1'));
      expect(dataBinder.emitted).toEqual([
        {
          shellId: 's1',
          command: RuntimeCommand.ResizeShell,
          cols: 100,
          rows: 30,
        },
      ]);
    });

    it('does not resize expired or missing shells', async () => {
      await store.resizeShell(shell('s1', true));
      await store.resizeShell(null);

      expect(dataBinder.emitted).toEqual([]);
    });

    it('keeps the shells if the server forbids resizing a shell', async () => {
      const opened = await openShell('a', 's1');
      store.switchToShell(opened);
      dataBinder.ack = FORBIDDEN;

      await store.resizeShell(opened);
      expect(store.getShellsForLab('a')).toEqual([shell('s1')]);
      expect(store.currentShell).toEqual(shell('s1'));
    });

    // Bug: resizeShell ignores the answer of the server
    it.fails('reports if the server forbids resizing a shell', async () => {
      dataBinder.ack = FORBIDDEN;

      await store.resizeShell(shell('s1'));
      expect(statusMessageStore.error).toHaveBeenCalled();
    });
  });

  describe('switching', () => {
    it('subscribes to the current shell and resizes it once connected', async () => {
      const first = await openShell('a', 's1');
      const second = await openShell('a', 's2');

      store.switchToShell(first);
      store.switchToShell(second);
      expect(store.currentShell).toEqual(second);
      expect([...dataBinder.callbacks.keys()]).toEqual([
        'shell-control',
        'shell/s2',
      ]);

      dataBinder.onConnect.get('shell/s2')!();
      await vi.advanceTimersByTimeAsync(0);
      expect(dataBinder.emitted).toMatchObject([{shellId: 's2'}]);
    });

    it('sends input to the current shell and passes on its output', async () => {
      const onData = vi.fn();
      store.onData.register(onData);
      store.sendData('ignored');

      store.switchToShell(await openShell('a', 's1'));
      store.sendData('ls\n');
      const output = new ArrayBuffer(1);
      dataBinder.callbacks.get('shell/s1')!(output);

      expect(dataBinder.sent).toEqual(['ls\n']);
      expect(onData).toHaveBeenCalledWith(output);
    });

    it('unsubscribes from the current shell', async () => {
      store.switchToShell(await openShell('a', 's1'));
      store.unsubscribeShell();
      store.unsubscribeShell();

      expect(store.currentShell).toBeNull();
      expect(dataBinder.callbacks.has('shell/s1')).toBe(false);
    });
  });

  describe('server updates', () => {
    it('marks a shell as expired when the server closes it', async () => {
      const opened = await openShell('a', 's1');
      await openShell('a', 's2');
      store.switchToShell(opened);

      control(ShellCommand.ShellClose, 'a', 's1');
      expect(store.getShellsForLab('a')).toEqual([
        shell('s1', true),
        shell('s2'),
      ]);
      expect(store.currentShell).toEqual(shell('s1', true));
    });

    it('marks a shell with an error as expired', async () => {
      await openShell('a', 's1');

      control(ShellCommand.ShellError, 'a', 's1');
      expect(store.getShellsForLab('a')).toEqual([shell('s1', true)]);
    });

    it('ignores updates of labs without shells', () => {
      control(ShellCommand.ShellClose, 'a', 's1');

      expect(store.openShells.has('a')).toBe(false);
    });

    it('fetches the shells of a lab and expires the ones that are gone', async () => {
      await openShell('a', 's1');
      await openShell('a', 's2');
      dataBinder.ack = {
        payload: [
          {id: 's2', node: 'r1'},
          {id: 's3', node: 'r2'},
        ],
      };

      await store.fetchShellsForLab(lab('a'));
      expect(dataBinder.emitted).toEqual([
        {labId: 'a', command: RuntimeCommand.FetchShells},
      ]);
      expect(store.getShellsForLab('a')).toEqual([
        shell('s1', true),
        shell('s2'),
        {id: 's3', node: 'r2', expired: false},
      ]);

      store.clearExpiredShells();
      expect(store.getShellsForLab('a').map(shell => shell.id)).toEqual([
        's2',
        's3',
      ]);
    });

    it('keeps the shells if fetching them fails', async () => {
      await openShell('a', 's1');
      dataBinder.ack = FORBIDDEN;

      await store.fetchShellsForLab(lab('a'));
      expect(store.getShellsForLab('a')).toEqual([shell('s1')]);
    });

    it('does not fetch shells of labs that are not deployed', async () => {
      await store.fetchShellsForLab({id: 'a', instance: null} as Lab);

      expect(dataBinder.emitted).toEqual([]);
    });
  });
});
