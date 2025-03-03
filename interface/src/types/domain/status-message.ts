export interface StatusMessageOut {
  id: string;
  timestamp: string;
  summary: string;
  detail: string;
  severity: Severity;
}

export type StatusMessage = {
  id: string;
  isRead: boolean;
  timestamp: Date;
  summary: string;
  detail: string;
  severity: Severity;
};

export enum Severity {
  Error,
  Warning,
  Success,
  Info,
}

export type PrimeSeverity = 'success' | 'info' | 'warn' | 'error';

export const SeverityMapping: {[key in Severity]: PrimeSeverity} = {
  [Severity.Error]: 'error',
  [Severity.Warning]: 'warn',
  [Severity.Success]: 'success',
  [Severity.Info]: 'info',
};
