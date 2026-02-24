import CalendarDialog from '@sb/components/calendar-dialog/calendar-dialog';
import StatusMessagePanel from '@sb/components/common/sb-dock/status-message-panel/status-message-panel';
import CreditsDialog from '@sb/components/credits-dialog/credits-dialog';
import {
  useAuthUser,
  useCollectionStore,
  useDataBinder,
  useStatusMessages,
} from '@sb/lib/stores/root-store';

import {Choose, If, Otherwise, When} from '@sb/types/control';
import {observer} from 'mobx-react-lite';
import {Badge} from 'primereact/badge';
import {Button} from 'primereact/button';

import {Image} from 'primereact/image';
import {OverlayPanel} from 'primereact/overlaypanel';
import React, {useMemo, useRef, useState} from 'react';
import {useNavigate} from 'react-router';

import './sb-dock.sass';
import classNames from 'classnames';

const SBDock: React.FC = observer(() => {
  const [isCreditsOpen, setCreditsOpen] = useState<boolean>(false);
  const [isCalendarOpen, setCalendarOpen] = useState<boolean>(false);

  const authUser = useAuthUser();
  const dataBinder = useDataBinder();
  const collectionStore = useCollectionStore();
  const navigate = useNavigate();
  const notificationStore = useStatusMessages();

  const overlayRef = useRef<OverlayPanel>(null);

  const hasEditorAccess = useMemo(() => {
    return authUser.isAdmin || collectionStore.hasAccessibleCollections;
  }, [authUser, collectionStore.hasAccessibleCollections]);

  return (
    <div className="flex align-items-stretch justify-content-between sb-card sb-dock">
      <div className="flex align-items-center gap-3">
        <div className="sb-logo-tab" onClick={() => navigate('/')}>
          <Image
            src="/icons/favicon-dark.png"
            width="50px"
            alt="Antimony Logo"
          />
        </div>
        <Choose>
          {/* Only show buttons in online mode and if the user has access to the editor */}
          <When condition={hasEditorAccess}>
            <Button
              icon={
                <span className="material-symbols-outlined">dashboard</span>
              }
              className={classNames('sb-dock-page-button', {
                selected: window.location.pathname === '/',
              })}
              label="Dashboard"
              onClick={() => navigate('/')}
              aria-label="Dashboard Page"
            />
            <Button
              icon={
                <span className="material-symbols-outlined">construction</span>
              }
              className={classNames('sb-dock-page-button', {
                selected: window.location.pathname === '/editor',
              })}
              label="Topology Editor"
              onClick={() => navigate('/editor')}
              aria-label="Topology Editor Page"
            />
          </When>
          <Otherwise>
            <span className="sb-dock-title">Antimony</span>
          </Otherwise>
        </Choose>
      </div>
      <div className="flex align-items-center gap-2 justify-content-end">
        <Button
          icon="pi pi-bell"
          size="large"
          onClick={e => overlayRef.current?.toggle(e)}
          pt={{
            icon: {
              className: 'p-overlay-badge',
              children: (
                <If condition={notificationStore.hasUnreadMessages}>
                  <Badge severity="danger" />
                </If>
              ),
            },
          }}
          tooltip="Messages"
          tooltipOptions={{position: 'bottom'}}
          aria-label="Messages"
        />
        <Button
          icon="pi pi-calendar"
          size="large"
          tooltip="Lab Schedule"
          tooltipOptions={{position: 'bottom'}}
          onClick={() => setCalendarOpen(true)}
          aria-label="Lab Schedule"
        />
        <Button
          icon="pi pi-info-circle"
          size="large"
          tooltip="Credits"
          tooltipOptions={{position: 'bottom'}}
          onClick={() => setCreditsOpen(true)}
          aria-label="Credits"
        />
        <If
          condition={
            !dataBinder.useNativeAutoLogin ||
            dataBinder.isAuthenticatedWithOidc()
          }
        >
          <Button
            size="large"
            icon="pi pi-sign-out"
            onClick={() => dataBinder.logout()}
            tooltip="Log Out"
            tooltipOptions={{position: 'bottom'}}
            aria-label="Log Out"
            className="ml-2"
          />
        </If>
      </div>

      <CreditsDialog
        isOpen={isCreditsOpen}
        onClose={() => setCreditsOpen(false)}
      />

      <CalendarDialog
        isOpen={isCalendarOpen}
        onClose={() => setCalendarOpen(false)}
      />

      <StatusMessagePanel ref={overlayRef} />
    </div>
  );
});

export default SBDock;
