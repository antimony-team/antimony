import React, {useEffect, useRef} from 'react';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';

import SBInput, {SBInputRef} from '@sb/components/common/sb-input/sb-input';
import {
  LabelKind,
  useGraphSelection,
} from '@sb/components/editor-page/topology-editor/node-editor/state/graph-selection';
import {If} from '@sb/types/control';

import './label-editor.sass';

interface LabelEditorProps {
  // Returns a validation error, or null if the value was accepted
  onSubmit: (value: string, isImplicit: boolean) => string | null;
}

/**
 * The field over a label that is edited in place. It is placed in the overlay
 * of the graph, so it is positioned in graph coordinates. Esc or leaving the
 * field without a valid value keeps the label as it was.
 */
const LabelEditor = observer((props: LabelEditorProps) => {
  const graphSelection = useGraphSelection();
  const inputRef = useRef<SBInputRef>(null);

  const labelEdit = graphSelection.labelEdit;

  useEffect(() => {
    if (!labelEdit) return;

    // The input is focused once it is shown, the value is selected so it can be replaced
    requestAnimationFrame(() => inputRef.current?.input.current?.select());
  }, [labelEdit]);

  return (
    <If condition={labelEdit}>
      <div
        key={`${labelEdit!.kind}-${labelEdit!.id}-${labelEdit!.endpointIndex}`}
        className={classNames('sb-label-editor', {
          // Group labels start at the field's top left corner, other labels are centered on it
          centered: labelEdit!.kind !== LabelKind.Group,
          mono: labelEdit!.kind === LabelKind.Interface,
        })}
        style={{left: labelEdit!.position.x, top: labelEdit!.position.y}}
        onKeyDown={event => {
          if (event.key === 'Escape') graphSelection.setLabelEdit(null);
        }}
        onBlur={() => queueMicrotask(() => graphSelection.setLabelEdit(null))}
      >
        <SBInput
          ref={inputRef}
          defaultValue={labelEdit!.value}
          ariaLabel="Label"
          autoFocus
          onValueSubmit={props.onSubmit}
        />
      </div>
    </If>
  );
});

export default LabelEditor;
