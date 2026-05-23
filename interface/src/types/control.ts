/*
 * These declarations are needed for the jsx-control-statements babel plugin.
 * The plugin transforms <If>/<Choose>/<When>/<Otherwise> JSX into regular
 * conditionals at compile time, so the runtime values here are never used —
 * they exist only so module bundlers can resolve the named imports.
 */

export const Otherwise: unknown = undefined;
export const When: unknown = undefined;
export const Choose: unknown = undefined;
export const If: unknown = undefined;
