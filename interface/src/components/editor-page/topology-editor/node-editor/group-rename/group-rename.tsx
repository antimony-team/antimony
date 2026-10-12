import React, {useEffect, useRef} from 'react';

import {observer} from 'mobx-react-lite';

import SBInput, {SBInputRef} from '@sb/components/common/sb-input/sb-input';
import {useGraphSelection} from '@sb/components/editor-page/topology-editor/node-editor/state/graph-selection';
import {GraphGroup, groupLabelInset} from '@sb/lib/graph/annotation-geometry';
import {groupStyle} from '@sb/lib/graph/annotation-style';
import {If} from '@sb/types/control';

import './group-rename.sass';

interface GroupRenameProps {
  groups: GraphGroup[];

  // Returns a validation error, or null if the name was accepted
  onRename: (name: string, isImplicit: boolean) => string | null;
}

/**
 * The input over the label of the group that is renamed. It is placed in the
 * overlay of the graph, so it is positioned in graph coordinates.
 */
const GroupRename = observer((props: GroupRenameProps) => {
  const graphSelection = useGraphSelection();
  const inputRef = useRef<SBInputRef>(null);

  const group =
    props.groups.find(group => group.id === graphSelection.renamingGroupId) ??
    null;
  const labelInset = group
    ? groupLabelInset(group, groupStyle(group.annotation).cornerRadius)
    : 0;

  useEffect(() => {
    if (!group) return;

    // The input is focused once it is shown, the name is selected so it can be replaced
    requestAnimationFrame(() => inputRef.current?.input.current?.select());
  }, [group?.id]);

  return (
    <If condition={group}>
      <div
        className="sb-group-rename"
        style={{
          left: group!.x + 4 + labelInset,
          top: group!.y + 2 + labelInset,
        }}
        onKeyDown={event => {
          if (event.key === 'Escape') graphSelection.setRenamingGroup(null);
        }}
        onBlur={() =>
          queueMicrotask(() => graphSelection.setRenamingGroup(null))
        }
      >
        <SBInput
          ref={inputRef}
          defaultValue={group!.name}
          autoFocus
          onValueSubmit={props.onRename}
        />
      </div>
    </If>
  );
});

export default GroupRename;
