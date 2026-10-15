import MarkdownIt from 'markdown-it';

/*
 * Links and images to other schemes, e.g. javascript:, are shown as plain text.
 * Images can be embedded as data URLs, an SVG in an image can't run scripts.
 */
const ALLOWED_LINK =
  /^(https?:|mailto:|data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,])/i;

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
}).disable(['table']);

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

const defaultImage = markdown.renderer.rules.image!;

// Images don't tell their server where they are shown, and can't be dragged out of the text
markdown.renderer.rules.image = (tokens, index, options, env, self) => {
  tokens[index].attrSet('referrerpolicy', 'no-referrer');
  tokens[index].attrSet('draggable', 'false');

  return defaultImage(tokens, index, options, env, self);
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
