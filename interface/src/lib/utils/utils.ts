import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import FileSaver from 'file-saver';

import {TooltipOptions} from 'primereact/tooltip/tooltipoptions';

import {Topology} from '@sb/types/domain/topology';
import {FetchState, Position} from '@sb/types/types';
dayjs.extend(duration);

export async function fetchResource<T>(
  url: string,
  method: string = 'GET',
  body?: T,
  requestHeaders?: HeadersInit,
): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: method,
      headers: requestHeaders,
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

export function matchesSearch(value: string, search: string) {
  return value.toLowerCase().includes(search.toLowerCase());
}

export function combinedFetchState(...fetchStates: FetchState[]): FetchState {
  const states = new Set(fetchStates);
  if (states.has(FetchState.Error)) return FetchState.Error;
  if (states.has(FetchState.Pending)) return FetchState.Pending;

  return FetchState.Done;
}

export function filterSchemaEnum(values: string[] | undefined) {
  if (values === undefined) return undefined;

  const unqiueIndices = [];
  const filteredValues = new Set<string>();

  for (let i = 0; i < values.length; i++) {
    if (filteredValues.has(values[i].toLowerCase())) continue;

    filteredValues.add(values[i].toLowerCase());
    unqiueIndices.push(i);
  }

  return unqiueIndices.map(index => values[index]);
}

export function arrayOf(value: string, length: number) {
  return [...Array(length)].map(() => value);
}

export function pushOrCreateList<T, R>(map: Map<T, R[]>, key: T, value: R) {
  if (map.has(key)) {
    map.get(key)!.push(value);
  } else {
    map.set(key, [value]);
  }
}

export function getDistance(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export const SBTooltipOptions: TooltipOptions = {
  position: 'top',
  showDelay: 200,
  showOnDisabled: true,
};

export function conditional<T>(condition: boolean, onTrue: T, onFalse: T) {
  return condition ? onTrue : onFalse;
}

export function isValidURL(url: string) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function getSSHCommand(
  collectionName: string,
  labName: string,
  nodeName: string,
  serverHost: string,
  serverPort: number,
  captureInterface?: string,
) {
  let command = 'ssh';
  if (serverPort !== 22) {
    command += ` -p ${serverPort}`;
  }

  // With -l, a name starting with a dash stays the username instead of becoming an ssh option
  const shellUser = shellQuote(`${collectionName}/${labName}/${nodeName}`);
  command += ` -l ${shellUser} ${serverHost}`;

  // After --, the interface is always the command and never an ssh option
  if (captureInterface) {
    command += ` -- ${shellQuote(captureInterface)} | wireshark -k -i -`;
  }

  return command;
}

export function formatBytes(v: number | null) {
  if (v === null) return '';

  const abs = Math.abs(v);
  const fmt = (n: number) => n.toFixed(1).replace(/\.0$/, '');
  if (abs >= 1024 ** 4) return fmt(v / 1024 ** 4) + ' TB';
  if (abs >= 1024 ** 3) return fmt(v / 1024 ** 3) + ' GB';
  if (abs >= 1024 ** 2) return fmt(v / 1024 ** 2) + ' MB';
  if (abs >= 1024) return fmt(v / 1024) + ' KB';
  return v.toFixed(0) + ' B';
}

export function downloadTopologyDefinition(
  topology: Topology,
  collectionName: string,
) {
  const blob = new Blob([topology.definition.toString()], {
    type: 'text/yaml;charset=utf-8',
  });
  FileSaver.saveAs(blob, `${collectionName}_${topology.definition.name}.yaml`);
}

export function formatDateTime(date: string | Date) {
  return new Date(date).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString([], {dateStyle: 'short'});
}

export function formatTime(date: string | Date, withSeconds = false) {
  return new Date(date).toLocaleTimeString([], {
    timeStyle: withSeconds ? 'medium' : 'short',
  });
}

export function uses12HourClock() {
  const hourCycle = new Intl.DateTimeFormat([], {
    hour: 'numeric',
  }).resolvedOptions().hourCycle;
  return hourCycle === 'h11' || hourCycle === 'h12';
}

/**
 * The locale's numeric date pattern in the notation of PrimeReact's Calendar, e.g. mm/dd/yy for en-US.
 */
export function localeDatePattern() {
  return new Intl.DateTimeFormat([], {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .formatToParts(new Date(2000, 0, 1))
    .map(part => {
      switch (part.type) {
        case 'day':
          return 'dd';
        case 'month':
          return 'mm';
        case 'year':
          return 'yy';
        default:
          return part.value.replace(/'/g, "''");
      }
    })
    .join('');
}

/** The locale's first day of the week, 0 being Sunday. */
export function localeFirstDayOfWeek() {
  const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
    getWeekInfo?: () => {firstDay: number};
    weekInfo?: {firstDay: number};
  };
  const firstDay = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
  return firstDay === undefined ? 0 : firstDay % 7;
}

export function formatUptime(deployed: string | Date, now = dayjs()) {
  const d = dayjs.duration(now.diff(dayjs(deployed)));
  const days = Math.floor(d.asDays());
  if (days >= 1) return `${days} d ${d.hours()} h`;
  if (d.asHours() >= 1) return `${d.hours()} h ${d.minutes()} min`;
  if (d.asMinutes() >= 1) return `${d.minutes()} min ${d.seconds()} s`;
  return `${d.seconds()} s`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds} s`;

  const minutes = Math.ceil(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;

  if (days) return hours ? `${days} d ${hours} h` : `${days} d`;
  if (hours) return mins ? `${hours} h ${mins} min` : `${hours} h`;
  return `${mins} min`;
}

/**
 * Whether a bind file path lies inside a directory, e.g. "node1/startup.cfg" in "node1", but not
 * "node10/startup.cfg" or "node1.cfg".
 */
export function isInDirectory(filePath: string, directory: string) {
  return filePath.startsWith(`${directory}/`);
}

export function pluralize(count: number, singular: string, plural: string) {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural}`;
}

export async function fetchSyncUrl(
  value: string,
): Promise<[string | null, string | null]> {
  if (value !== '' && !isValidURL(value)) {
    return ['Specified URL is not valid', null];
  }

  const response = await fetchResource(value);

  if (!response?.ok) {
    return ['Unable to fetch from the provided resource.', null];
  }

  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('text')) {
    return ['Unable to fetch from the provided resource.', null];
  } else {
    return [null, await response.text()];
  }
}

/**
 * Returns a free name for a duplicate of the topology with the given name, e.g.
 * "topology-1" for "topology". A name that already ends in a number counts on
 * from it, so a copy of "topology-1" is "topology-2" instead of "topology-1-1".
 */
export function createDuplicateName(
  name: string,
  takenNames: string[],
): string {
  const taken = new Set(takenNames);
  const match = /^(.*)-(\d+)$/.exec(name);

  const base = match ? match[1] : name;
  let number = match ? Number(match[2]) + 1 : 1;

  while (taken.has(`${base}-${number}`)) number++;

  return `${base}-${number}`;
}

// Leaves plain names as they are, everything else is single-quoted so the shell takes it literally
function shellQuote(value: string) {
  if (/^[\w./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
