import {FileCodec} from '@sb/lib/format/file-codec';

/**
 * Files without a format the editor understands, e.g. bind files: their text
 * is their value and is always valid.
 */
export class PlainTextFormat implements FileCodec<string> {
  public parse(text: string): string {
    return text;
  }

  public serialize(text: string): string {
    return text;
  }
}
