import {editor} from 'monaco-editor';

import {ColorScheme} from '@sb/lib/stores/theme-store';

export const MonacoOptions: editor.IStandaloneEditorConstructionOptions = {
  autoIndent: 'full',
  minimap: {
    enabled: false,
  },
  scrollbar: {
    verticalScrollbarSize: 8,
  },
  renderLineHighlight: 'none',
  stickyScroll: {
    enabled: false,
  },
  automaticLayout: true,
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  hideCursorInOverviewRuler: true,
  overviewRulerBorder: false,
  overviewRulerLanes: 0,
  wordWrap: 'on',
  tabSize: 2,
};

export const AntimonyTheme: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.foreground': '#3DC9B0',
    'editor.background': '#00000000',
    focusBorder: '#00000000',
  },
};

// Dark text with the keys in the accent, the light base theme colors most of YAML in teal otherwise
export const AntimonyLightTheme: editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    {token: '', foreground: '25282D'},
    {token: 'type', foreground: '0B5F4B'},
    {token: 'string', foreground: '25282D'},
    {token: 'number', foreground: 'A85A12'},
    {token: 'keyword', foreground: '8A35A3'},
    {token: 'comment', foreground: '858A93'},
  ],
  colors: {
    'editor.foreground': '#25282D',
    'editorLineNumber.foreground': '#5F656E',
    'editorLineNumber.activeForeground': '#25282D',
    'editor.background': '#00000000',
    focusBorder: '#00000000',
  },
};

// The name of the Monaco theme of a color scheme
export const monacoTheme = (scheme: ColorScheme) =>
  scheme === 'light' ? 'antimonyLightTheme' : 'antimonyTheme';
