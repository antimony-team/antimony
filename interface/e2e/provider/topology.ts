import {topologyDefinition} from '../fixtures/api';

// What the nodes write to their log when they start
export const STARTED_MARKER = 'antimony-e2e-started';

// Plain alpine exits right away, the command keeps it running
const COMMAND = `      cmd: sh -c "echo ${STARTED_MARKER}; exec sleep infinity"\n`;

/** The fixtures' topology of host1 and host2, with nodes that keep running on a real provider. */
export function runningNodes(name: string) {
  return topologyDefinition(name, ['host1', 'host2'], COMMAND);
}
