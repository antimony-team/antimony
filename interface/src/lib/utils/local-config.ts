/**
 * Parses a field to a boolean.
 *
 * Returns null if the field was not defined. Returns false if the field was invalid.
 *
 * @param key The key to the cookie.
 */
export function readBool(key: string): boolean | null {
  const value = window.localStorage.getItem(key);
  if (!value) return null;

  return window.localStorage.getItem(key) === 'true';
}

/**
 * Parses a field to an integer.
 *
 * Returns null if the field was not defined or invalid.
 *
 * @param key The key to the cookie.
 */
export function readInt(key: string): number | null {
  const value = window.localStorage.getItem(key);
  if (!value) return null;

  const number = parseInt(value);
  return isNaN(number) ? null : number;
}

/**
 * Parses a field to a float.
 *
 * Returns null if the field was not defined or invalid.
 *
 * @param key The key to the field.
 */
export function readFloat(key: string): number | null {
  const value = window.localStorage.getItem(key);
  if (!value) return null;

  const number = parseFloat(value);
  return isNaN(number) ? null : number;
}
