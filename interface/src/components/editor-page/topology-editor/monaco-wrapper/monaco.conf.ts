import {editor} from 'monaco-editor';

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
