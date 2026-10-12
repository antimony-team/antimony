import MarkdownIt from 'markdown-it';

// Links to other schemes, e.g. javascript: or data:, are shown as plain text
const ALLOWED_LINK = /^(https?:|mailto:)/i;

// The number of rendered texts that are kept, the cache is cleared beyond it
const CACHE_SIZE = 200;

/*
 * HTML in the text is shown as text instead of being rendered, so the rendered
 * output only contains the elements markdown-it creates itself.
 */
const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
}).disable(['image', 'table']);

markdown.validateLink = url => ALLOWED_LINK.test(url.trim());

const defaultLinkOpen =
  markdown.renderer.rules.link_open ??
  ((tokens, index, options, _, self) =>
    self.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');

  return defaultLinkOpen(tokens, index, options, env, self);
};

const cache = new Map<string, string>();

/**
 * Returns the HTML of the given markdown. The result is cached, so texts that
 * didn't change aren't rendered again.
 */
export function renderMarkdown(text: string): string {
  const cached = cache.get(text);
  if (cached !== undefined) return cached;

  if (cache.size >= CACHE_SIZE) cache.clear();

  const html = markdown.render(text);
  cache.set(text, html);

  return html;
}
