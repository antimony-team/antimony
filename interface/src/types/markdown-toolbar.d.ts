import {DetailedHTMLProps, HTMLAttributes} from 'react';

// The elements of @github/markdown-toolbar-element
type MarkdownToolbarProps = DetailedHTMLProps<
  HTMLAttributes<HTMLElement>,
  HTMLElement
> & {for?: string; level?: string};

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'markdown-toolbar': MarkdownToolbarProps;
      'md-bold': MarkdownToolbarProps;
      'md-italic': MarkdownToolbarProps;
      'md-strikethrough': MarkdownToolbarProps;
      'md-code': MarkdownToolbarProps;
      'md-header': MarkdownToolbarProps;
      'md-unordered-list': MarkdownToolbarProps;
      'md-ordered-list': MarkdownToolbarProps;
      'md-link': MarkdownToolbarProps;
    }
  }
}
