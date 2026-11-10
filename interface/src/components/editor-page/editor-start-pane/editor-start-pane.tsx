import React from 'react';

import {observer} from 'mobx-react-lite';

import {Button} from 'primereact/button';

import SBEmptyState from '@sb/components/common/sb-empty-state/sb-empty-state';
import {useEditorTabStore} from '@sb/lib/stores/root-store';
import {formatTimeAgo} from '@sb/lib/utils/utils';
import {Choose, If, Otherwise, When} from '@sb/types/control';

import './editor-start-pane.sass';

interface EditorStartPaneProps {
  onAddTopology: () => void;
}

/**
 * The editor while no file is shown: what to do next, or why a file that was
 * asked for can't be shown, and the files the user opened last.
 */
const EditorStartPane = observer((props: EditorStartPaneProps) => {
  const tabStore = useEditorTabStore();
  const missingId = tabStore.missingId;

  const recentFiles = tabStore.recentFiles
    .map(file => ({...file, summary: tabStore.summary(file.id)!}))
    .slice(0, 5);

  return (
    <div className="sb-editor-start-pane">
      <Choose>
        <When condition={missingId !== null}>
          <SBEmptyState
            title="Topology not found"
            text="This topology doesn't exist anymore, or you don't have access to it. It may have been deleted or moved to another collection."
            icon={<span className="material-symbols-outlined">link_off</span>}
            warning
          >
            <div className="sb-editor-start-pane-missing">
              <code className="sb-editor-start-pane-link">
                /editor?f={missingId}
              </code>
              <Button
                outlined
                icon="pi pi-times"
                label="Close"
                onClick={() => tabStore.dismissMissing()}
              />
            </div>
          </SBEmptyState>
        </When>
        <Otherwise>
          <SBEmptyState
            title="No topology open"
            text="Pick a topology from the list on the left, or create a new one."
            icon={
              <span className="material-symbols-outlined">network_node</span>
            }
          >
            <Button
              icon="pi pi-plus"
              label="New topology"
              className="sb-button-accent"
              onClick={() => props.onAddTopology()}
            />
          </SBEmptyState>
        </Otherwise>
      </Choose>
      <If condition={recentFiles.length > 0}>
        <section
          className="sb-editor-start-pane-recent"
          aria-labelledby="sb-editor-recent-title"
        >
          <h2 id="sb-editor-recent-title">Recently opened</h2>
          <ul>
            {recentFiles.map(file => (
              <li key={file.id}>
                <button onClick={() => tabStore.open(file.id)}>
                  <span
                    className="material-symbols-outlined sb-editor-start-pane-icon"
                    aria-hidden="true"
                  >
                    {file.summary.icon}
                  </span>
                  <span className="sb-editor-start-pane-title">
                    {file.summary.title}
                  </span>
                  <span className="sb-editor-start-pane-subtitle">
                    {file.summary.subtitle}
                  </span>
                  <span className="sb-editor-start-pane-time">
                    {formatTimeAgo(file.openedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </If>
    </div>
  );
});

export default EditorStartPane;
