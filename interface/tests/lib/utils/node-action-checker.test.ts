import {describe, expect, it} from 'vitest';

import {NodeActionChecker} from '@sb/lib/utils/node-action-checker';
import {
  Instance,
  InstanceNode,
  InstanceNodeState,
  InstanceState,
} from '@sb/types/domain/lab';

function createInstance(state: InstanceState) {
  return {state} as Instance;
}

function createNode(
  state: InstanceNodeState,
  isReady = true,
  canRestart = true,
) {
  return {state, isReady, canRestart} as InstanceNode;
}

function actionsOf(checker: NodeActionChecker) {
  return {
    start: !!checker.canStart,
    stop: !!checker.canStop,
    restart: !!checker.canRestart,
    terminal: !!checker.canOpenTerminal,
    logs: checker.canShowLogs,
    stats: !!checker.canShowStats,
    captures: !!checker.canShowCaptures,
  };
}

describe('NodeActionChecker', () => {
  const running = createInstance(InstanceState.Running);

  it('allows stopping and using a running node', () => {
    expect(
      actionsOf(
        new NodeActionChecker(running, createNode(InstanceNodeState.Running)),
      ),
    ).toEqual({
      start: false,
      stop: true,
      restart: true,
      terminal: true,
      logs: true,
      stats: true,
      captures: true,
    });
  });

  it('only allows starting a stopped node', () => {
    const node = createNode(InstanceNodeState.Stopped, false);
    expect(actionsOf(new NodeActionChecker(running, node))).toEqual({
      start: true,
      stop: false,
      restart: false,
      terminal: false,
      logs: true,
      stats: false,
      captures: false,
    });
  });

  it('allows no state changes while a node starts or stops', () => {
    for (const state of [
      InstanceNodeState.Starting,
      InstanceNodeState.Stopping,
    ]) {
      const checker = new NodeActionChecker(running, createNode(state));
      expect([checker.canStart, checker.canStop, checker.canRestart]).toEqual([
        false,
        false,
        false,
      ]);
    }
  });

  it('allows no state changes for nodes that can not restart', () => {
    const node = createNode(InstanceNodeState.Running, true, false);
    const checker = new NodeActionChecker(running, node);
    expect(!!checker.canStop || !!checker.canRestart).toBe(false);
    expect(checker.canOpenTerminal).toBe(true);
  });

  it('only allows logs while the lab is not running', () => {
    const instance = createInstance(InstanceState.Deploying);
    const node = createNode(InstanceNodeState.Running);
    expect(actionsOf(new NodeActionChecker(instance, node))).toEqual({
      start: false,
      stop: false,
      restart: false,
      terminal: false,
      logs: true,
      stats: false,
      captures: false,
    });
  });

  it('allows nothing without an instance', () => {
    const checker = new NodeActionChecker(null, null);
    expect(Object.values(actionsOf(checker)).some(Boolean)).toBe(false);
  });
});
