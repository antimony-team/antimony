import React, {
  forwardRef,
  SyntheticEvent,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import {observer} from 'mobx-react-lite';

import {ContextMenu} from 'primereact/contextmenu';
import {MenuItem} from 'primereact/menuitem';

import {useContextMenuStore} from '@sb/lib/stores/root-store';

export interface SBContextMenuRef {
  show: (event: SyntheticEvent) => void;
  hide: (event?: SyntheticEvent) => void;
}

interface SBContextMenuProps {
  model?: MenuItem[];
  onHide?: () => void;
}

/**
 * A context menu that is shown in the context menu of the app, which only
 * shows one menu at a time. It is used like the context menu of PrimeReact.
 *
 * The menu opens once the component rendered again, so it shows the model that
 * was set together with opening it.
 */
const SBContextMenu = forwardRef<SBContextMenuRef, SBContextMenuProps>(
  (props, ref) => {
    const contextMenuStore = useContextMenuStore();

    const [owner] = useState(() => Symbol('context-menu'));
    const [openEvent, setOpenEvent] = useState<{
      event: SyntheticEvent;
    } | null>(null);

    const onHideRef = useRef(props.onHide);
    onHideRef.current = props.onHide;

    // Like the context menu of PrimeReact, the event stops where the menu is opened
    useImperativeHandle(ref, () => ({
      show: event => {
        event.stopPropagation();
        event.preventDefault();
        setOpenEvent({event});
      },
      hide: () => contextMenuStore.close(owner),
    }));

    useEffect(() => {
      if (!openEvent) return;

      contextMenuStore.open({
        owner,
        model: props.model ?? [],
        event: openEvent.event,
        onHide: () => onHideRef.current?.(),
      });
    }, [openEvent]);

    useEffect(() => () => contextMenuStore.close(owner), []);

    return null;
  },
);

/**
 * The only context menu of the app, it shows the menu that was opened last. It
 * closes on any press outside of it, the context menu of PrimeReact only closes
 * on a click.
 */
export const SBContextMenuHost = observer(() => {
  const contextMenuStore = useContextMenuStore();
  const contextMenuRef = useRef<ContextMenu>(null);

  const request = contextMenuStore.request;

  // The menu takes its items over in an effect, which runs before this one
  useEffect(() => {
    if (request && contextMenuStore.isOpen) {
      contextMenuRef.current?.show(request.event);
    }
  }, [request]);

  useEffect(() => {
    // The event is only passed on to onHide, which doesn't use it
    if (!contextMenuStore.isOpen) {
      contextMenuRef.current?.hide(null as unknown as SyntheticEvent);
    }
  }, [contextMenuStore.isOpen]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.('.p-contextmenu')) contextMenuStore.close();
    };

    window.addEventListener('mousedown', onMouseDown, true);
    return () => window.removeEventListener('mousedown', onMouseDown, true);
  }, []);

  return (
    <ContextMenu
      ref={contextMenuRef}
      model={request?.model}
      onHide={() => contextMenuStore.close()}
    />
  );
});

export default SBContextMenu;
