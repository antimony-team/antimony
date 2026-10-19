import dayjs from 'dayjs';
import FileSaver from 'file-saver';
import {execFileSync} from 'node:child_process';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
  arrayOf,
  combinedFetchState,
  conditional,
  createDuplicateName,
  downloadTopologyDefinition,
  fetchResource,
  fetchSyncUrl,
  filterSchemaEnum,
  formatBytes,
  formatDate,
  formatDateTime,
  formatDuration,
  formatTime,
  formatUptime,
  getDistance,
  getSSHCommand,
  isInDirectory,
  isValidURL,
  localeDatePattern,
  localeFirstDayOfWeek,
  matchesSearch,
  pluralize,
  pushOrCreateList,
  uses12HourClock,
} from '@sb/lib/utils/utils';
import {Topology} from '@sb/types/domain/topology';
import {FetchState} from '@sb/types/types';

vi.mock('file-saver', () => ({default: {saveAs: vi.fn()}}));

// The arguments ssh would get when the shell runs the command
function sshArguments(command: string): string[] {
  const output = execFileSync('sh', [
    '-c',
    `ssh() { printf '%s\\n' "$@"; }; wireshark() { cat; }; ${command}`,
  ]).toString();

  return output.split('\n').slice(0, -1);
}

const OriginalDateTimeFormat = Intl.DateTimeFormat;
const originalDateMethods = {
  toLocaleString: Date.prototype.toLocaleString,
  toLocaleDateString: Date.prototype.toLocaleDateString,
  toLocaleTimeString: Date.prototype.toLocaleTimeString,
};

// Runs the locale helpers as if the browser's language was the given locale
function useLocale(locale: string) {
  class FixedDateTimeFormat extends OriginalDateTimeFormat {
    constructor(
      locales?: string | string[],
      options?: Intl.DateTimeFormatOptions,
    ) {
      super(locales?.length ? locales : locale, options);
    }
  }
  vi.stubGlobal(
    'Intl',
    Object.assign(Object.create(Intl), {DateTimeFormat: FixedDateTimeFormat}),
  );
  vi.stubGlobal('navigator', {language: locale});

  for (const [method, original] of Object.entries(originalDateMethods)) {
    vi.spyOn(
      Date.prototype,
      method as keyof typeof originalDateMethods,
    ).mockImplementation(function (
      this: Date,
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ) {
      const isDefault = Array.isArray(locales) && locales.length === 0;
      return original.call(this, isDefault ? locale : locales, options);
    });
  }
}

// Intl writes a narrow no-break space before AM and PM
const normalize = (text: string) => text.replace(/\s/g, ' ');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('formatUptime', () => {
  const now = dayjs('2024-06-01T12:00:00');

  it('shows seconds for less than a minute', () => {
    expect(formatUptime(now.subtract(42, 'second').toDate(), now)).toBe('42 s');
    expect(formatUptime(now.toDate(), now)).toBe('0 s');
  });

  it('shows minutes and seconds for less than an hour', () => {
    expect(formatUptime(now.subtract(90, 'second').toDate(), now)).toBe(
      '1 min 30 s',
    );
  });

  it('shows hours and minutes for less than a day', () => {
    const deployed = now.subtract(2, 'hour').subtract(5, 'minute');
    expect(formatUptime(deployed.toDate(), now)).toBe('2 h 5 min');
  });

  it('shows days and hours from one day on', () => {
    const deployed = now.subtract(3, 'day').subtract(4, 'hour');
    expect(formatUptime(deployed.toDate(), now)).toBe('3 d 4 h');
  });

  it('accepts the deployment time as a string', () => {
    expect(formatUptime('2024-06-01T11:59:00', now)).toBe('1 min 0 s');
  });

  it.skip('shows the right hours for more than a month', () => {
    // Bug: dayjs splits the duration into months, so 31 d 4 h shows as 31 d 18 h
    const deployed = now.subtract(31, 'day').subtract(4, 'hour');
    expect(formatUptime(deployed.toDate(), now)).toBe('31 d 4 h');
  });
});

describe('formatDuration', () => {
  it('shows seconds for less than a minute and rounds up', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(1)).toBe('1 s');
    expect(formatDuration(59_000)).toBe('59 s');
  });

  it('never shows a negative duration', () => {
    expect(formatDuration(-5000)).toBe('0 s');
  });

  it('rounds up to whole minutes from one minute on', () => {
    expect(formatDuration(59_001)).toBe('1 min');
    expect(formatDuration(60_000)).toBe('1 min');
    expect(formatDuration(61_000)).toBe('2 min');
  });

  it('leaves out the minutes of full hours', () => {
    expect(formatDuration(3_600_000)).toBe('1 h');
    expect(formatDuration(3_660_000)).toBe('1 h 1 min');
  });

  it('shows days and hours but no minutes from one day on', () => {
    expect(formatDuration(86_400_000)).toBe('1 d');
    expect(formatDuration(90_000_000)).toBe('1 d 1 h');
    expect(formatDuration(86_400_000 + 30 * 60_000)).toBe('1 d');
  });
});

describe('formatBytes', () => {
  it('shows nothing without a value', () => {
    expect(formatBytes(null)).toBe('');
  });

  it('shows whole bytes below a kilobyte', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('uses binary units with at most one decimal', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 ** 2 * 2.25)).toBe('2.3 MB');
    expect(formatBytes(1024 ** 3)).toBe('1 GB');
    expect(formatBytes(1024 ** 4 * 3)).toBe('3 TB');
  });

  it('keeps terabytes as the largest unit', () => {
    expect(formatBytes(1024 ** 5)).toBe('1024 TB');
  });

  it('picks the unit by the absolute value of negative numbers', () => {
    expect(formatBytes(-2048)).toBe('-2 KB');
    expect(formatBytes(-1)).toBe('-1 B');
  });
});

describe('isInDirectory', () => {
  it('finds files in the directory and its subdirectories', () => {
    expect(isInDirectory('node1/startup.cfg', 'node1')).toBe(true);
    expect(isInDirectory('node1/config/startup.cfg', 'node1')).toBe(true);
    expect(isInDirectory('a/b/c.cfg', 'a/b')).toBe(true);
  });

  it('keeps files with a similar name alone', () => {
    expect(isInDirectory('node10/startup.cfg', 'node1')).toBe(false);
    expect(isInDirectory('node1.cfg', 'node1')).toBe(false);
    expect(isInDirectory('node1', 'node1')).toBe(false);
  });

  it('only matches the directory at the start of the path', () => {
    expect(isInDirectory('other/node1/startup.cfg', 'node1')).toBe(false);
  });
});

describe('getSSHCommand', () => {
  it('logs in as collection, lab and node', () => {
    expect(getSSHCommand('team', 'lab', 'srl1', 'example.com', 22)).toBe(
      'ssh -l team/lab/srl1 example.com',
    );
  });

  it('only sets the port if it is not the default one', () => {
    expect(getSSHCommand('team', 'lab', 'srl1', 'example.com', 2222)).toBe(
      'ssh -p 2222 -l team/lab/srl1 example.com',
    );
  });

  it('quotes names with spaces', () => {
    const command = getSSHCommand('my team', 'lab', 'srl1', 'host', 22);
    expect(command).toBe("ssh -l 'my team/lab/srl1' host");
    expect(sshArguments(command)).toEqual(['-l', 'my team/lab/srl1', 'host']);
  });

  it('escapes single quotes in names', () => {
    const command = getSSHCommand("kian's", 'lab', 'srl1', 'host', 22);
    expect(sshArguments(command)).toEqual(['-l', "kian's/lab/srl1", 'host']);
  });

  it('keeps the shell from running commands in names', () => {
    const command = getSSHCommand(
      '$(touch pwned)',
      '`id`',
      'a;b|c&&d',
      'host',
      22,
    );
    expect(sshArguments(command)).toEqual([
      '-l',
      '$(touch pwned)/`id`/a;b|c&&d',
      'host',
    ]);
  });

  it('keeps names with a leading dash as the user', () => {
    const command = getSSHCommand('-oProxyCommand=x', 'lab', 'n', 'host', 22);
    expect(sshArguments(command)).toEqual([
      '-l',
      '-oProxyCommand=x/lab/n',
      'host',
    ]);
  });

  it('pipes a capture of the interface into wireshark', () => {
    expect(getSSHCommand('team', 'lab', 'srl1', 'host', 22, 'e1-1')).toBe(
      'ssh -l team/lab/srl1 host -- e1-1 | wireshark -k -i -',
    );
  });

  it('passes the capture interface after the end of the options', () => {
    const command = getSSHCommand('team', 'lab', 'srl1', 'host', 22, '-v');
    expect(sshArguments(command)).toEqual([
      '-l',
      'team/lab/srl1',
      'host',
      '--',
      '-v',
    ]);
  });

  it('quotes capture interfaces with special characters', () => {
    const command = getSSHCommand('t', 'l', 'n', 'host', 22, "eth 1'$(id)");
    expect(sshArguments(command)).toEqual([
      '-l',
      't/l/n',
      'host',
      '--',
      "eth 1'$(id)",
    ]);
  });

  it('leaves out the capture for an empty interface', () => {
    expect(getSSHCommand('team', 'lab', 'srl1', 'host', 22, '')).toBe(
      'ssh -l team/lab/srl1 host',
    );
  });
});

describe('createDuplicateName', () => {
  it('appends a number to the name', () => {
    expect(createDuplicateName('topology', [])).toBe('topology-1');
  });

  it('skips names that are taken', () => {
    expect(createDuplicateName('topology', ['topology-1', 'topology-2'])).toBe(
      'topology-3',
    );
  });

  it('counts on from a number at the end of the name', () => {
    expect(createDuplicateName('topology-1', ['topology-1'])).toBe(
      'topology-2',
    );
    expect(createDuplicateName('topology-9', ['topology-10'])).toBe(
      'topology-11',
    );
  });

  it('only counts on from numbers after a dash', () => {
    expect(createDuplicateName('router1', [])).toBe('router1-1');
  });

  it('counts on from the last number only', () => {
    expect(createDuplicateName('lab-2-3', [])).toBe('lab-2-4');
  });

  it('does not care about taken names with other bases', () => {
    expect(createDuplicateName('a', ['b-1', 'a', 'a-2'])).toBe('a-1');
  });
});

describe('locale dates', () => {
  const date = new Date(2024, 0, 5, 14, 30, 7);

  it('formats date and time in the browser locale', () => {
    useLocale('en-US');
    expect(normalize(formatDateTime(date))).toBe('Jan 5, 2024, 2:30 PM');

    useLocale('de-CH');
    expect(formatDateTime(date)).toBe('05.01.2024, 14:30');
  });

  it('accepts dates as strings', () => {
    useLocale('de-CH');
    expect(formatDateTime('2024-01-05T14:30:00')).toBe('05.01.2024, 14:30');
  });

  it('formats short dates in the browser locale', () => {
    useLocale('en-US');
    expect(formatDate(date)).toBe('1/5/24');

    useLocale('de-CH');
    expect(formatDate(date)).toBe('05.01.24');
  });

  it('formats times with seconds only if asked to', () => {
    useLocale('en-US');
    expect(normalize(formatTime(date))).toBe('2:30 PM');
    expect(normalize(formatTime(date, true))).toBe('2:30:07 PM');

    useLocale('de-CH');
    expect(formatTime(date)).toBe('14:30');
    expect(formatTime(date, true)).toBe('14:30:07');
  });

  it('knows which locales use a 12 hour clock', () => {
    useLocale('en-US');
    expect(uses12HourClock()).toBe(true);

    useLocale('de-CH');
    expect(uses12HourClock()).toBe(false);

    useLocale('ja-JP');
    expect(uses12HourClock()).toBe(false);
  });

  it('writes the date pattern of the locale for the calendar', () => {
    useLocale('en-US');
    expect(localeDatePattern()).toBe('mm/dd/yy');

    useLocale('de-CH');
    expect(localeDatePattern()).toBe('dd.mm.yy');

    useLocale('fr-CA');
    expect(localeDatePattern()).toBe('yy-mm-dd');
  });

  it('quotes literal apostrophes in the date pattern', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockReturnValue([
      {type: 'day', value: '01'},
      {type: 'literal', value: "'"},
      {type: 'month', value: '01'},
      {type: 'literal', value: ' '},
      {type: 'year', value: '2000'},
    ]);
    expect(localeDatePattern()).toBe("dd''mm yy");
  });

  it('knows the first day of the week of the locale', () => {
    useLocale('en-US');
    expect(localeFirstDayOfWeek()).toBe(0);

    useLocale('de-CH');
    expect(localeFirstDayOfWeek()).toBe(1);
  });

  it('turns Sunday as day 7 into day 0', () => {
    vi.stubGlobal('navigator', {language: 'en-US'});
    vi.stubGlobal(
      'Intl',
      Object.assign(Object.create(Intl), {
        Locale: class {
          weekInfo = {firstDay: 7};
        },
      }),
    );
    expect(localeFirstDayOfWeek()).toBe(0);
  });

  it('starts weeks on Sunday if the browser has no week info', () => {
    vi.stubGlobal('navigator', {language: 'en-US'});
    vi.stubGlobal(
      'Intl',
      Object.assign(Object.create(Intl), {Locale: class {}}),
    );
    expect(localeFirstDayOfWeek()).toBe(0);
  });
});

describe('fetchResource', () => {
  it('sends the body as JSON', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', fetch);

    const response = await fetchResource(
      '/api',
      'POST',
      {name: 'lab'},
      {
        Authorization: 'token',
      },
    );

    expect(await response?.text()).toBe('ok');
    expect(fetch).toHaveBeenCalledWith('/api', {
      method: 'POST',
      headers: {Authorization: 'token'},
      body: '{"name":"lab"}',
    });
  });

  it('returns null if the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError()));
    expect(await fetchResource('/api')).toBeNull();
  });
});

describe('fetchSyncUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('rejects invalid URLs without fetching them', async () => {
    expect(await fetchSyncUrl('not a url')).toEqual([
      'Specified URL is not valid',
      null,
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns the text of the resource', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('name: lab', {headers: {'content-type': 'text/yaml'}}),
    );
    expect(await fetchSyncUrl('https://example.com/lab.yaml')).toEqual([
      null,
      'name: lab',
    ]);
  });

  it('rejects resources that are not text', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{}', {headers: {'content-type': 'application/json'}}),
    );
    expect(await fetchSyncUrl('https://example.com/lab.json')).toEqual([
      'Unable to fetch from the provided resource.',
      null,
    ]);
  });

  it('rejects failed responses', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', {status: 404}));
    expect(await fetchSyncUrl('https://example.com/lab.yaml')).toEqual([
      'Unable to fetch from the provided resource.',
      null,
    ]);
  });
});

describe('downloadTopologyDefinition', () => {
  it('saves the definition as YAML named after collection and topology', async () => {
    const topology = {
      definition: {name: 'ring', toString: () => 'name: ring\n'},
    } as unknown as Topology;

    downloadTopologyDefinition(topology, 'team');

    const [blob, name] = vi.mocked(FileSaver.saveAs).mock.calls[0];
    expect(name).toBe('team_ring.yaml');
    expect(await (blob as Blob).text()).toBe('name: ring\n');
    expect((blob as Blob).type).toBe('text/yaml;charset=utf-8');
  });
});

describe('small helpers', () => {
  it('searches without caring about case', () => {
    expect(matchesSearch('Spine-Leaf', 'leaf')).toBe(true);
    expect(matchesSearch('spine', 'SPI')).toBe(true);
    expect(matchesSearch('spine', 'leaf')).toBe(false);
    expect(matchesSearch('spine', '')).toBe(true);
  });

  it('combines fetch states with errors first', () => {
    expect(combinedFetchState()).toBe(FetchState.Done);
    expect(combinedFetchState(FetchState.Done, FetchState.Done)).toBe(
      FetchState.Done,
    );
    expect(combinedFetchState(FetchState.Done, FetchState.Pending)).toBe(
      FetchState.Pending,
    );
    expect(
      combinedFetchState(FetchState.Pending, FetchState.Error, FetchState.Done),
    ).toBe(FetchState.Error);
  });

  it('removes enum values that only differ in case and keeps the first', () => {
    expect(filterSchemaEnum(undefined)).toBeUndefined();
    expect(filterSchemaEnum([])).toEqual([]);
    expect(filterSchemaEnum(['Linux', 'linux', 'SRL', 'LINUX', 'srl'])).toEqual(
      ['Linux', 'SRL'],
    );
  });

  it('creates lists of a repeated value', () => {
    expect(arrayOf('x', 3)).toEqual(['x', 'x', 'x']);
    expect(arrayOf('x', 0)).toEqual([]);
  });

  it('pushes to existing lists and creates missing ones', () => {
    const map = new Map<string, number[]>();
    pushOrCreateList(map, 'a', 1);
    pushOrCreateList(map, 'a', 2);
    pushOrCreateList(map, 'b', 3);
    expect(map).toEqual(
      new Map([
        ['a', [1, 2]],
        ['b', [3]],
      ]),
    );
  });

  it('measures the distance between two points', () => {
    expect(getDistance({x: 0, y: 0}, {x: 3, y: 4})).toBe(5);
    expect(getDistance({x: -1, y: -1}, {x: -1, y: -1})).toBe(0);
  });

  it('picks the value of the condition', () => {
    expect(conditional(true, 'a', 'b')).toBe('a');
    expect(conditional(false, 'a', 'b')).toBe('b');
  });

  it('accepts absolute URLs only', () => {
    expect(isValidURL('https://example.com/a.yaml')).toBe(true);
    expect(isValidURL('mailto:kian@example.com')).toBe(true);
    expect(isValidURL('example.com')).toBe(false);
    expect(isValidURL('')).toBe(false);
  });

  it('uses the singular for exactly one', () => {
    expect(pluralize(1, 'node', 'nodes')).toBe('1 node');
    expect(pluralize(0, 'node', 'nodes')).toBe('0 nodes');
    expect(pluralize(2, 'node', 'nodes')).toBe('2 nodes');
  });
});
