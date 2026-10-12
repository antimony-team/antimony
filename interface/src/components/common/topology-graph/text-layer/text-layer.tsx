import React, {KeyboardEvent, useLayoutEffect, useRef} from 'react';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';

import {GraphText, TextSize} from '@sb/lib/graph/annotation-geometry';
import {NO_COLOR, textStyle} from '@sb/lib/graph/annotation-style';
import {renderMarkdown} from '@sb/lib/graph/markdown';
import {Choose, Otherwise, When} from '@sb/types/control';
import {FreeTextAnnotation} from '@sb/types/domain/topology';

import './text-layer.sass';

// The formatting shortcuts while a text is edited, by key
const FORMAT_SHORTCUTS = new Map([
  ['b', 'md-bold'],
  ['i', 'md-italic'],
  ['k', 'md-link'],
]);

/**
 * The state of the texts in an editable graph. It is read in this component,
 * so a change of the selection only renders the texts again.
 */
export interface TextLayerState {
  textIds: string[];

  // This text shows handles instead of the selection outline
  transformTargetId: string | null;

  editingTextId: string | null;

  // Changes that replace the stored fields while they are changed
  textPreviews: Map<string, Partial<FreeTextAnnotation>>;

  setTextSize: (textId: string, size: TextSize) => void;
}

interface TextLayerProps {
  texts: GraphText[];
  state?: TextLayerState;

  // Called with the edited text once editing ends
  onEditEnd?: (textId: string, text: string) => void;
}

const TextLayer = (props: TextLayerProps) => {
  return (
    <>
      {props.texts.map(text => (
        <TextView
          key={text.id}
          text={text}
          state={props.state}
          onEditEnd={props.onEditEnd}
        />
      ))}
    </>
  );
};

/**
 * Returns the ID of the field a text is edited in, which the formatting
 * toolbar refers to.
 */
export function textEditorId(textId: string) {
  return `sb-text-editor-${textId}`;
}

interface TextViewProps {
  text: GraphText;
  state?: TextLayerState;
  onEditEnd?: (textId: string, text: string) => void;
}

// Each text reads the state on its own, so only the texts that change render again
const TextView = observer(({text, state, onEditEnd}: TextViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const annotation = {...text.annotation, ...state?.textPreviews.get(text.id)};
  const style = textStyle(annotation);
  const isEditing = state?.editingTextId === text.id;

  // Texts without a height, e.g. from other editors, grow with their text
  const isSized = annotation.height !== undefined;

  // The size is measured once the text is laid out, so it is never read during a render
  useLayoutEffect(() => {
    if (!state || !containerRef.current) return;

    const resizeObserver = new ResizeObserver(([entry]) => {
      const size = entry.borderBoxSize[0];
      state.setTextSize(text.id, {
        width: size.inlineSize,
        height: size.blockSize,
      });
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [text.id, state]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Editing ends like a click outside, which saves the text
    if (
      event.key === 'Escape' ||
      (event.key === 'Enter' && (event.ctrlKey || event.metaKey))
    ) {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }

    const button = FORMAT_SHORTCUTS.get(event.key.toLowerCase());
    if (!button || !(event.ctrlKey || event.metaKey)) return;

    event.preventDefault();
    document
      .querySelector<HTMLElement>(
        `markdown-toolbar[for="${CSS.escape(textEditorId(text.id))}"] ${button}`,
      )
      ?.click();
  }

  return (
    <div
      ref={containerRef}
      data-layer-id={text.id}
      className={classNames('sb-graph-text', {
        selected:
          state?.textIds.includes(text.id) &&
          state.transformTargetId !== text.id,
        editing: isEditing,
        sized: isSized,
      })}
      style={{
        left: annotation.position.x,
        top: annotation.position.y,
        width: annotation.width,
        height: annotation.height,
        fontSize: style.fontSize,
        color: style.fontColor,
        backgroundColor:
          style.backgroundColor === NO_COLOR
            ? undefined
            : style.backgroundColor,
        textAlign: style.textAlign,
      }}
    >
      <Choose>
        <When condition={isEditing}>
          <textarea
            id={textEditorId(text.id)}
            className="sb-graph-text-editor"
            defaultValue={annotation.text}
            autoFocus
            ref={isSized ? undefined : fitTextarea}
            onInput={event => !isSized && fitTextarea(event.currentTarget)}
            onKeyDown={onKeyDown}
            onBlur={event => onEditEnd?.(text.id, event.currentTarget.value)}
          />
        </When>
        <Otherwise>
          <div
            className="sb-graph-text-content"
            dangerouslySetInnerHTML={{__html: renderMarkdown(annotation.text)}}
          />
        </Otherwise>
      </Choose>
    </div>
  );
});

// The field of a text without a height grows with the text, like the rendered text
function fitTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;

  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

export default TextLayer;
