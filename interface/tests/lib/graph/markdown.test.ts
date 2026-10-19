import {describe, expect, it} from 'vitest';

import {renderMarkdown} from '@sb/lib/graph/markdown';

describe('renderMarkdown', () => {
  it('renders markdown to HTML', () => {
    expect(renderMarkdown('# Title\n\n**bold** and *italic*')).toBe(
      '<h1>Title</h1>\n<p><strong>bold</strong> and <em>italic</em></p>\n',
    );
  });

  it('turns single line breaks into breaks', () => {
    expect(renderMarkdown('a\nb')).toBe('<p>a<br>\nb</p>\n');
  });

  it('shows HTML as text', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>\n',
    );
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).not.toContain(
      '<img',
    );
  });

  it('opens links in a new tab without an opener', () => {
    expect(renderMarkdown('[docs](https://antimony.run)')).toBe(
      '<p><a href="https://antimony.run" target="_blank" rel="noopener noreferrer">docs</a></p>\n',
    );
  });

  it('turns plain URLs into links', () => {
    expect(renderMarkdown('see https://antimony.run')).toContain(
      '<a href="https://antimony.run" target="_blank"',
    );
  });

  it('allows mail links', () => {
    expect(renderMarkdown('[mail](mailto:kian@example.com)')).toContain(
      'href="mailto:kian@example.com"',
    );
  });

  it('shows links to other schemes as text', () => {
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'vbscript:x',
      'data:text/html,<b>x</b>',
      'file:///etc/passwd',
    ]) {
      expect(renderMarkdown(`[click](${url})`)).not.toContain('<a');
    }
  });

  it('allows images as data URLs and over HTTP', () => {
    expect(renderMarkdown('![logo](data:image/png;base64,AAAA)')).toBe(
      '<p><img src="data:image/png;base64,AAAA" alt="logo" referrerpolicy="no-referrer" draggable="false"></p>\n',
    );
    expect(renderMarkdown('![a](data:image/svg+xml,<svg/>)')).toContain('<img');
    expect(renderMarkdown('![a](https://example.com/a.png)')).toContain(
      '<img src="https://example.com/a.png"',
    );
  });

  it('shows images of other types as text', () => {
    expect(renderMarkdown('![a](data:image/bmp;base64,AAAA)')).not.toContain(
      '<img',
    );
    expect(renderMarkdown('![a](javascript:alert(1))')).not.toContain('<img');
  });

  it('does not render tables', () => {
    expect(renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |')).not.toContain(
      '<table',
    );
  });

  it('returns the same HTML for the same text', () => {
    const text = 'cached **text**';
    expect(renderMarkdown(text)).toBe(renderMarkdown(text));
  });

  it('still renders after the cache is full', () => {
    for (let i = 0; i < 250; i++) renderMarkdown(`text ${i}`);
    expect(renderMarkdown('text 3')).toBe('<p>text 3</p>\n');
  });
});
