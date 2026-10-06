import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';

import './editor-view-switch.sass';

export type EditorView = 'code' | 'split' | 'graph';

const editorViews: readonly EditorView[] = ['code', 'split', 'graph'];

const views: {value: EditorView; label: string; icon: string}[] = [
  {value: 'code', label: 'Code', icon: 'code'},
  {value: 'split', label: 'Split', icon: 'view_column_2'},
  {value: 'graph', label: 'Graph', icon: 'network_node'},
];

export const isValidEditorView = (
  value: unknown,
): value is (typeof editorViews)[number] => {
  return editorViews.includes(value as (typeof editorViews)[number]);
};

interface EditorViewSwitchProps {
  value: EditorView;
  onChange: (view: EditorView) => void;
  disabledViews?: EditorView[];
}

const EditorViewSwitch = (props: EditorViewSwitchProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isReady, setReady] = useState(false);

  // Move the indicator under the selected option, also when the font or size changes
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const update = () => {
      const active = root.querySelector<HTMLElement>('[aria-checked="true"]');
      if (!active) return;

      root.style.setProperty('--indicator-x', `${active.offsetLeft}px`);
      root.style.setProperty('--indicator-w', `${active.offsetWidth}px`);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, [props.value]);

  // Enable the transition only after the first position is set, so it doesn't slide in on load
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      ref={rootRef}
      role="radiogroup"
      aria-label="Editor view"
      className="sb-editor-view-switch"
      data-ready={isReady || undefined}
    >
      {views.map(view => (
        <button
          key={view.value}
          role="radio"
          aria-checked={view.value === props.value}
          className="sb-editor-view-switch-option"
          disabled={props.disabledViews?.includes(view.value) || false}
          onClick={() => props.onChange(view.value)}
        >
          <span className="material-symbols-outlined">{view.icon}</span>
          {view.label}
        </button>
      ))}
    </div>
  );
};

export default EditorViewSwitch;
