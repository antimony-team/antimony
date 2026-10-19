import {uuid4} from '@sb/types/types';

export interface StatusMessageOut {
  id: uuid4;
  timestamp: string;
  source: string;
  content: string;
  logContent: string;
  severity: Severity;
}

export type StatusMessage = {
  id: uuid4;
  isRead: boolean;
  timestamp: Date;
  source: string;
  content: string;
  logContent: string;
  severity: Severity;
};

export enum Severity {
  Success,
  Info,
  Warning,
  Error,
  Fatal,
}

export type PrimeSeverity = 'success' | 'info' | 'warn' | 'error';

export const SeverityMapping: {[key in Severity]: PrimeSeverity} = {
  [Severity.Success]: 'success',
  [Severity.Info]: 'info',
  [Severity.Warning]: 'warn',
  [Severity.Error]: 'error',
  [Severity.Fatal]: 'error',
};

export const SeverityIconMap: {[key in Severity]: string} = {
  [Severity.Success]: 'pi pi-check-circle',
  [Severity.Info]: 'pi pi-info-circle',
  [Severity.Warning]: 'pi pi-exclamation-circle',
  [Severity.Error]: 'pi pi-times-circle',
  [Severity.Fatal]: 'pi pi-times-circle',
};
