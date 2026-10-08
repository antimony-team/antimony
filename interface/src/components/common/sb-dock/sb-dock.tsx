import React, {useLayoutEffect, useMemo, useRef, useState} from 'react';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';
import {useLocation, useNavigate} from 'react-router';

import {Badge} from 'primereact/badge';
import {Button} from 'primereact/button';
import {Image} from 'primereact/image';
import {OverlayPanel} from 'primereact/overlaypanel';
import {TooltipOptions} from 'primereact/tooltip/tooltipoptions';

import CalendarDialog from '@sb/components/calendar-dialog/calendar-dialog';
import StatusMessagePanel from '@sb/components/common/sb-dock/status-message-panel/status-message-panel';
import CreditsDialog from '@sb/components/credits-dialog/credits-dialog';
import {
  useAuthUser,
  useCollectionStore,
  useDataBinder,
  useStatusMessages,
} from '@sb/lib/stores/root-store';
import {readPersistentValue} from '@sb/lib/utils/persistent-state';
import {Choose, If, Otherwise, When} from '@sb/types/control';

import './sb-dock.sass';

const SBDock = observer(() => {
  const [isCreditsOpen, setCreditsOpen] = useState<boolean>(false);
  const [isCalendarOpen, setCalendarOpen] = useState<boolean>(false);

  const authUser = useAuthUser();
  const dataBinder = useDataBinder();
  const collectionStore = useCollectionStore();
  const navigate = useNavigate();
  const notificationStore = useStatusMessages();

  const {pathname} = useLocation();

  const overlayRef = useRef<OverlayPanel>(null);

  const hasEditorAccess = useMemo(() => {
    return authUser.isAdmin || collectionStore.hasAccessibleCollections;
  }, [authUser, collectionStore.hasAccessibleCollections]);

  const dockButtonTooltipOptions: TooltipOptions = {
    position: 'bottom',
    showDelay: 500,
  };

  const pageButtonsRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const nav = pageButtonsRef.current;
    if (!nav) return;

    const update = () => {
      const selected = nav.querySelector<HTMLElement>('.p-button.selected');
      nav.style.setProperty('--indicator-x', `${selected?.offsetLeft ?? 0}px`);
      nav.style.setProperty('--indicator-w', `${selected?.offsetWidth ?? 0}px`);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    const frame = requestAnimationFrame(() => (nav.dataset.ready = ''));

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [pathname]);

  function openEditor() {
    let path = '/editor';
    const lastOpenFile = readPersistentValue('last-open-file');
    if (lastOpenFile) {
      path += `?f=${lastOpenFile}`;
    }
    void navigate(path);
  }

  return (
    <div className="flex align-items-stretch justify-content-between sb-island sb-dock">
      <div className="flex align-items-center gap-3">
        <div className="sb-dock-logo" onClick={() => navigate('/')}>
          <Image src="./antimony-logo.svg" width="25px" alt="Antimony Logo" />
          <span>Antimony</span>
          <span className="sb-dock-separator" />
        </div>
        <Choose>
          {/* Only show buttons in online mode and if the user has access to the editor */}
          <When condition={hasEditorAccess}>
            <div className="sb-dock-page-buttons" ref={pageButtonsRef}>
              <Button
                text
                icon={
                  <span className="material-symbols-outlined">dashboard</span>
                }
                className={classNames('sb-dock-page-button', {
                  selected: pathname === '/' || pathname === '',
                })}
                label="Dashboard"
                onMouseDown={() => navigate('/')}
                aria-label="Dashboard Page"
              />
              <Button
                text
                icon={
                  <span className="material-symbols-outlined">
                    network_node
                  </span>
                }
                className={classNames('sb-dock-page-button', {
                  selected: pathname === '/editor',
                })}
                label="Topology Editor"
                onMouseDown={openEditor}
                aria-label="Topology Editor Page"
              />
            </div>
          </When>
          <Otherwise>
            <span className="sb-dock-title">Antimony</span>
          </Otherwise>
        </Choose>
      </div>
      <div className="flex align-items-center gap-2 justify-content-end">
        <Button
          text
          icon="pi pi-bell"
          size="large"
          onClick={e => overlayRef.current?.toggle(e)}
          pt={{
            icon: {
              className: 'p-overlay-badge',
              children: (
                <If condition={notificationStore.hasUnreadMessages}>
                  <Badge severity="secondary" />
                </If>
              ),
            },
          }}
          tooltip="Messages"
          tooltipOptions={dockButtonTooltipOptions}
          aria-label="Messages"
        />
        <Button
          text
          icon="pi pi-calendar"
          size="large"
          tooltip="Lab Schedule"
          tooltipOptions={dockButtonTooltipOptions}
          onClick={() => setCalendarOpen(true)}
          aria-label="Lab Schedule"
        />
        <Button
          text
          icon="pi pi-info-circle"
          size="large"
          tooltip="Credits"
          tooltipOptions={dockButtonTooltipOptions}
          onClick={() => setCreditsOpen(true)}
          aria-label="Credits"
        />
        <If
          condition={
            !dataBinder.isAuthDisabled &&
            (!dataBinder.useNativeAutoLogin ||
              dataBinder.isAuthenticatedWithOidc)
          }
        >
          <Button
            text
            size="large"
            icon="pi pi-sign-out"
            onClick={() => dataBinder.logout(true)}
            tooltip="Log Out"
            tooltipOptions={dockButtonTooltipOptions}
            aria-label="Log Out"
            className="ml-2"
          />
        </If>
      </div>

      <If condition={dataBinder.isLoggedIn}>
        <CreditsDialog
          isOpen={isCreditsOpen}
          onClose={() => setCreditsOpen(false)}
        />

        <CalendarDialog
          isOpen={isCalendarOpen}
          onClose={() => setCalendarOpen(false)}
        />

        <StatusMessagePanel ref={overlayRef} />
      </If>
    </div>
  );
});

export default SBDock;
