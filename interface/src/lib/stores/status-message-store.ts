import React from 'react';

import {Toast} from 'primereact/toast';
import {action, computed, observable} from 'mobx';

import {RootStore} from '@sb/lib/stores/root-store';
import {DataStore} from '@sb/lib/stores/data-store';
import {
  SBConfirmOpenProps,
  SBConfirmRef,
} from '@sb/components/common/sb-confirm/sb-confirm';
import {RemoteDataBinder} from '@sb/lib/stores/data-binder/remote-data-binder';
import {
  Severity,
  SeverityMapping,
  StatusMessage,
  StatusMessageOut,
} from '@sb/types/domain/status-message';
import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';

export class StatusMessageStore extends DataStore<
  StatusMessage,
  void,
  StatusMessageOut
> {
  private toastRef: React.RefObject<Toast> | null = null;
  private confirmRef: React.RefObject<SBConfirmRef> | null = null;

  @observable accessor countBySeverity: Map<Severity, number> = new Map();

  constructor(rootStore: RootStore) {
    super(rootStore);

    if (!process.env.IS_OFFLINE) {
      (this.rootStore._dataBinder as RemoteDataBinder).socket.on(
        'status-message',
        data => {
          this.handleMessage(StatusMessageStore.parseMessage(data, false));
        }
      );
    }
  }

  protected get resourcePath(): string {
    return '/status-messages';
  }
  protected handleUpdate(response: DataResponse<StatusMessageOut[]>): void {
    this.data = response.payload
      .map(msg => StatusMessageStore.parseMessage(msg, true))
      .toSorted((a, b) => a.timestamp.valueOf() - b.timestamp.valueOf());
    this.countBySeverity = new Map(
      Object.entries(
        Object.groupBy(this.data, message => message.severity)
      ).map(([severity, list]) => [Number(severity), list.length])
    );
  }

  @computed
  public get lookup(): Map<string, StatusMessage> {
    return new Map(this.data.map(message => [message.id, message]));
  }

  @computed
  public get unreadMessages(): number {
    return this.data.filter(msg => !msg.isRead).length;
  }

  @action
  public clear() {
    this.data = [];
  }

  public success = (message: string, title: string = 'Success') => {
    this.send(message, title, Severity.Success);
  };

  public info = (message: string, title: string = 'Info') => {
    this.send(message, title, Severity.Info);
  };

  public error = (message: string, title: string = 'Error') => {
    this.send(message, title, Severity.Error);
  };

  public warning = (message: string, title: string = 'Warning') => {
    this.send(message, title, Severity.Warning);
  };

  public confirm(props: SBConfirmOpenProps) {
    if (!this.confirmRef?.current) return;

    this.confirmRef.current.show(props);
  }

  public setToast(toastRef: React.RefObject<Toast>) {
    this.toastRef = toastRef;
  }

  public setConfirm(confirmRef: React.RefObject<SBConfirmRef>) {
    this.confirmRef = confirmRef;
  }

  @action
  public maskAsRead(id: string) {
    if (!this.lookup.has(id)) return;

    this.lookup.get(id)!.isRead = true;
    this.data = [...this.data];
  }

  @action
  public markAllAsRead() {
    this.data.forEach(msg => (msg.isRead = true));
    this.data = [...this.data];
  }

  @action
  private send(message: string, title: string, severity: Severity): void {
    if (!this.toastRef?.current) return;
    const msg = {
      summary: title,
      detail: message,
      severity: SeverityMapping[severity],
    };
    this.toastRef.current.show(msg);
  }

  @action
  private handleMessage(message: StatusMessage) {
    this.lookup.set(message.id, message);
    this.countBySeverity.set(
      message.severity,
      (this.countBySeverity.get(message.severity) ?? 0) + 1
    );
    this.data.push(message);
    this.data = [...this.data];
    this.send(message.detail, message.summary, message.severity);
  }

  public static parseMessage(
    input: StatusMessageOut,
    isRead: boolean
  ): StatusMessage {
    return {
      ...input,
      timestamp: new Date(input.timestamp),
      isRead,
    };
  }
}
