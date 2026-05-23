/*
 * These declarations exist for the jsx-control-statements babel plugin.
 * The plugin rewrites <If>/<Choose>/<When>/<Otherwise> JSX into plain
 * conditionals at compile time, so the runtime values are never actually
 * used. They exist purely so that:
 *   - Module bundlers (
 * esbuild's dep scanner) can resolve the named imports
 *   - TypeScript accepts them as valid JSX component types
 *
 * The babel plugin strips out the JSX before this dummy component is ever
 * rendered.
 */

import type {FC, ReactNode} from 'react';

type ControlProps = {[key: string]: unknown; children?: ReactNode};
const noop: FC<ControlProps> = () => null;

export const Otherwise = noop;
export const When = noop;
export const Choose = noop;
export const If = noop;
