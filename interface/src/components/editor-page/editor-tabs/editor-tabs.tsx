import React, {MouseEvent} from 'react';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';

import {EditorDocument} from '@sb/lib/editor/document/editor-document';
import {useEditorTabStore, useStatusMessages} from '@sb/lib/stores/root-store';
import {If} from '@sb/types/control';

import './editor-tabs.sass';

/**
 * The open files of the editor, one tab each. The tabs sit above the editor
 * island and the shown one is part of it.
 */
const EditorTabs = observer(() => {
  const tabStore = useEditorTabStore();
  const notificationStore = useStatusMessages();

  if (tabStore.documents.length === 0) return null;

  function close(document: EditorDocument) {
    if (!document.isEdited) {
      tabStore.close(document.id);
      return;
    }

    notificationStore.confirm({
      header: 'Discard unsaved changes?',
      message: `Your changes to "${document.title}" haven't been saved.`,
      severity: 'warning',
      acceptText: 'Discard changes',
      rejectText: 'Keep editing',
      onAccept: () => tabStore.close(document.id),
    });
  }

  function onMouseDown(event: MouseEvent, document: EditorDocument) {
    // The middle button closes a tab, like in a browser
    if (event.button === 1) {
      event.preventDefault();
      close(document);
    }
  }

  return (
    <div className="sb-editor-tabs" role="tablist" aria-label="Open files">
      {tabStore.documents.map(document => {
        const isActive = document.id === tabStore.activeId;
        const isPreview = document.id === tabStore.previewId;

        return (
          <div
            key={document.id}
            className={classNames('sb-editor-tab', {
              active: isActive,
              preview: isPreview,
              edited: document.isEdited,
            })}
            onMouseDown={event => onMouseDown(event, document)}
          >
            <button
              role="tab"
              aria-selected={isActive}
              className="sb-editor-tab-label"
              title={`${document.title} (${document.subtitle})`}
              onClick={() => tabStore.activate(document.id)}
              // A double click keeps a preview tab open
              onDoubleClick={() => tabStore.pin(document.id)}
            >
              <span
                className="material-symbols-outlined sb-editor-tab-icon"
                aria-hidden="true"
              >
                {document.icon}
              </span>
              <span className="sb-editor-tab-title" data-text={document.title}>
                {document.title}
              </span>
              <If condition={document.subtitle}>
                <span className="sb-editor-tab-subtitle">
                  {document.subtitle}
                </span>
              </If>
            </button>
            <button
              className="sb-editor-tab-close"
              aria-label={
                document.isEdited
                  ? `Close ${document.title}, it has unsaved changes`
                  : `Close ${document.title}`
              }
              onClick={() => close(document)}
            >
              <span className="sb-editor-tab-dot" aria-hidden="true" />
              <span
                className="material-symbols-outlined sb-editor-tab-x"
                aria-hidden="true"
              >
                close
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
});

export default EditorTabs;
