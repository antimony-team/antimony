import React from 'react';

import '@github/markdown-toolbar-element';

interface Format {
  element:
    | 'md-bold'
    | 'md-italic'
    | 'md-strikethrough'
    | 'md-code'
    | 'md-header'
    | 'md-unordered-list'
    | 'md-ordered-list'
    | 'md-link'
    | 'md-image';
  icon: string;
  label: string;
}

const FORMATS: Format[] = [
  {element: 'md-bold', icon: 'format_bold', label: 'Bold (Ctrl B)'},
  {element: 'md-italic', icon: 'format_italic', label: 'Italic (Ctrl I)'},
  {
    element: 'md-strikethrough',
    icon: 'strikethrough_s',
    label: 'Strikethrough',
  },
  {element: 'md-code', icon: 'code', label: 'Code'},
  {element: 'md-header', icon: 'title', label: 'Heading'},
  {element: 'md-unordered-list', icon: 'format_list_bulleted', label: 'List'},
  {
    element: 'md-ordered-list',
    icon: 'format_list_numbered',
    label: 'Numbered list',
  },
  {element: 'md-link', icon: 'link', label: 'Link (Ctrl K)'},
  {element: 'md-image', icon: 'image', label: 'Image'},
];

interface MarkdownToolbarProps {
  // The ID of the field that is formatted
  fieldId: string;
}

/**
 * The formatting buttons while a text is edited. They wrap the selection or the
 * word at the cursor in the markdown of the format.
 */
const MarkdownToolbar = (props: MarkdownToolbarProps) => {
  return (
    <markdown-toolbar
      for={props.fieldId}
      className="sb-markdown-toolbar"
      // The field keeps the focus, it stops being edited once it loses it
      onMouseDown={event => event.preventDefault()}
    >
      {FORMATS.map(({element: Element, icon, label}) => (
        <Element
          key={Element}
          className="sb-markdown-toolbar-button"
          data-pr-tooltip={label}
          aria-label={label}
        >
          <span className="material-symbols-outlined">{icon}</span>
        </Element>
      ))}
    </markdown-toolbar>
  );
};

export default MarkdownToolbar;
