import {RefObject} from 'react';

import {beforeEach, describe, expect, it, vi} from 'vitest';

import {Toast} from 'primereact/toast';

import {SBConfirmRef} from '@sb/components/common/sb-confirm/sb-confirm';
import {RootStore} from '@sb/lib/stores/root-store';
import {StatusMessageStore} from '@sb/lib/stores/status-message-store';
import {Severity, StatusMessageOut} from '@sb/types/domain/status-message';

function message(id: string, severity: Severity): StatusMessageOut {
  return {
    id,
    timestamp: '2026-01-01T12:00:00Z',
    source: 'Lab',
    content: `Message ${id}`,
    logContent: `Log ${id}`,
    severity,
  };
}

describe('StatusMessageStore', () => {
  let receive: (data: {payload: StatusMessageOut}) => void;
  let store: StatusMessageStore;
  let show: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const dataBinder = {
      subscribeNamespace: (
        namespace: string,
        onData: (data: {payload: StatusMessageOut}) => void,
      ) => {
        expect(namespace).toBe('status-messages');
        receive = onData;
      },
    };
    store = new StatusMessageStore({
      _dataBinder: dataBinder,
    } as unknown as RootStore);

    show = vi.fn();
    store.setToast({current: {show}} as unknown as RefObject<Toast | null>);
  });

  it('parses the timestamp of a message', () => {
    const parsed = StatusMessageStore.parseMessage(
      message('1', Severity.Info),
      true,
    );

    expect(parsed.timestamp).toEqual(new Date('2026-01-01T12:00:00Z'));
    expect(parsed.isRead).toBe(true);
  });

  it('shows received messages as unread toasts', () => {
    receive({payload: message('1', Severity.Warning)});

    expect(show).toHaveBeenCalledWith({
      summary: 'Lab',
      detail: 'Message 1',
      severity: 'warn',
    });
    expect(store.hasUnreadMessages).toBe(true);
    expect(store.countBySeverity.get(Severity.Warning)).toBe(1);
  });

  it('lists the newest messages first', () => {
    receive({payload: message('1', Severity.Info)});
    receive({payload: message('2', Severity.Error)});

    expect(store.filteredMessages.map(msg => msg.id)).toEqual(['2', '1']);
  });

  it('filters the messages by the selected severities', () => {
    receive({payload: message('1', Severity.Info)});
    receive({payload: message('2', Severity.Error)});
    receive({payload: message('3', Severity.Fatal)});

    store.toggleSeverity(Severity.Error);
    store.toggleSeverity(Severity.Fatal);
    expect(store.filteredMessages.map(msg => msg.id)).toEqual(['3', '2']);

    store.toggleSeverity(Severity.Error);
    store.toggleSeverity(Severity.Fatal);
    expect(store.filteredMessages).toHaveLength(3);
  });

  it('marks single messages and all messages as read', () => {
    receive({payload: message('1', Severity.Info)});
    receive({payload: message('2', Severity.Info)});

    store.maskAsRead('1');
    store.maskAsRead('unknown');
    expect(store.hasUnreadMessages).toBe(true);

    store.markAllAsRead();
    expect(store.hasUnreadMessages).toBe(false);
    expect(store.filteredMessages.every(msg => msg.isRead)).toBe(true);
  });

  it('clears all messages and their counts', () => {
    receive({payload: message('1', Severity.Info)});
    store.clear();

    expect(store.filteredMessages).toEqual([]);
    expect(store.countBySeverity.size).toBe(0);
    expect(store.hasUnreadMessages).toBe(false);
  });

  it('shows messages of the interface with their default titles', () => {
    store.success('Saved');
    store.info('Note');
    store.warning('Careful');
    store.error('Failed', 'Custom title');

    expect(show.mock.calls.map(([msg]) => [msg.summary, msg.severity])).toEqual(
      [
        ['Success', 'success'],
        ['Info', 'info'],
        ['Warning', 'warn'],
        ['Custom title', 'error'],
      ],
    );
    expect(store.filteredMessages).toEqual([]);
  });

  it('shows nothing before the toast is mounted', () => {
    store.setToast({current: null});

    expect(() => store.error('Failed')).not.toThrow();
    expect(show).not.toHaveBeenCalled();
  });

  it('opens a confirmation once the dialog is mounted', () => {
    const props = {message: 'Sure?', header: 'Delete', onAccept: () => {}};
    expect(() => store.confirm(props)).not.toThrow();

    const confirm = {show: vi.fn()};
    store.setConfirm({
      current: confirm,
    } as unknown as RefObject<SBConfirmRef | null>);
    store.confirm(props);

    expect(confirm.show).toHaveBeenCalledWith(props);
  });
});
