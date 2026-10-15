import React from 'react';

import {action, computed, observable, ObservableSet} from 'mobx';

import {Toast} from 'primereact/toast';

import {
  SBConfirmOpenProps,
  SBConfirmRef,
} from '@sb/components/common/sb-confirm/sb-confirm';
import {DataResponse} from '@sb/lib/stores/data-binder/data-binder';
import {RootStore} from '@sb/lib/stores/root-store';
import {
  Severity,
  SeverityMapping,
  StatusMessage,
  StatusMessageOut,
} from '@sb/types/domain/status-message';

export class StatusMessageStore {
  @observable accessor countBySeverity: Map<Severity, number> = new Map();
  @observable accessor filteredMessages: StatusMessage[] = [];
  @observable accessor severityFilter: ObservableSet<Severity> =
    new ObservableSet();
  protected rootStore: RootStore;
  private data: StatusMessage[] = observable<StatusMessage>([]);
  private lookup: Map<string, StatusMessage> = new Map();
  private toastRef: React.RefObject<Toast | null> | null = null;
  private confirmRef: React.RefObject<SBConfirmRef | null> | null = null;

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;

    this.rootStore._dataBinder.subscribeNamespace(
      'status-messages',
      this.handleMessage.bind(this),
    );
  }

  @computed
  public get hasUnreadMessages(): boolean {
    return this.data.filter(msg => !msg.isRead).length > 0;
  }

  public static parseMessage(
    input: StatusMessageOut,
    isRead: boolean,
  ): StatusMessage {
    return {
      ...input,
      timestamp: new Date(input.timestamp),
      isRead,
    };
  }

  @action
  public toggleSeverity(severity: Severity) {
    if (this.severityFilter.has(severity)) {
      this.severityFilter.delete(severity);
    } else {
      this.severityFilter.add(severity);
    }

    this.updateFilteredMessages();
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

  public setToast(toastRef: React.RefObject<Toast | null>) {
    this.toastRef = toastRef;
  }

  public setConfirm(confirmRef: React.RefObject<SBConfirmRef | null>) {
    this.confirmRef = confirmRef;
  }

  @action
  public maskAsRead(id: string) {
    if (!this.lookup.has(id)) return;

    this.data.find(msg => msg.id === id)!.isRead = true;

    this.updateFilteredMessages();
  }

  @action
  public markAllAsRead() {
    this.data.forEach(msg => (msg.isRead = true));

    this.updateFilteredMessages();
  }

  @action
  private handleMessage(data: DataResponse<StatusMessageOut>) {
    const message = StatusMessageStore.parseMessage(data.payload, false);
    this.lookup.set(message.id, message);

    this.countBySeverity.set(
      message.severity,
      (this.countBySeverity.get(message.severity) ?? 0) + 1,
    );
    this.data.push(message);
    this.send(message.content, message.source, message.severity);
    console.log(
      `[SERVER] ${Severity[message.severity].toUpperCase()} ${message.logContent}`,
    );

    this.updateFilteredMessages();
  }

  @action
  private updateFilteredMessages() {
    this.filteredMessages = this.data
      .filter(
        msg =>
          this.severityFilter.size < 1 || this.severityFilter.has(msg.severity),
      )
      .toReversed();
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
}
