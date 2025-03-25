import {uuid4} from '@sb/types/types';

export interface StatusMessageOut {
  id: uuid4;
  timestamp: string;
  summary: string;
  detail: string;
  severity: Severity;
}

export type StatusMessage = {
  id: uuid4;
  isRead: boolean;
  timestamp: Date;
  summary: string;
  detail: string;
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
