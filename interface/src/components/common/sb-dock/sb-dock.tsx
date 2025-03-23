import React, {useMemo, useRef, useState} from 'react';

import {Image} from 'primereact/image';
import {Badge} from 'primereact/badge';
import {Button} from 'primereact/button';
import {observer} from 'mobx-react-lite';
import {useNavigate} from 'react-router';
import {OverlayPanel} from 'primereact/overlaypanel';

import {Choose, If, Otherwise, When} from '@sb/types/control';
import StatusMessagePanel from '@sb/components/common/sb-dock/status-message-panel/status-message-panel';
import CreditsDialog from '@sb/components/credits-dialog/credits-dialog';
import {
  useCollectionStore,
  useDataBinder,
  useStatusMessages,
} from '@sb/lib/stores/root-store';
import CalendarDialog from '@sb/components/calendar-dialog/calendar-dialog';

import './sb-dock.sass';

const SBDock: React.FC = observer(() => {
  const [isCreditsOpen, setCreditsOpen] = useState<boolean>(false);
  const [isCalendarOpen, setCalendarOpen] = useState<boolean>(false);

  const dataBinder = useDataBinder();
  const collectionStore = useCollectionStore();
  const navigate = useNavigate();
  const notificationStore = useStatusMessages();

  const overlayRef = useRef<OverlayPanel>(null);

  const hasEditorAccess = useMemo(() => {
    return dataBinder.isAdmin || collectionStore.hasWritableCollections;
  }, [dataBinder.isAdmin, collectionStore.hasWritableCollections]);

  return (
    <div className="flex align-items-stretch justify-content-between sb-card sb-dock">
      <div className="flex align-items-center gap-2">
        <div
          className="sb-logo-tab sb-corner-tab"
          onClick={() => navigate('/')}
        >
          <Image
            src="/assets/icons/favicon-dark.png"
            width="60px"
            alt="Antimony Logo"
          />
        </div>
        <Choose>
          {/* Only show buttons in online mode and if user has access to editor */}
          <When condition={!process.env.IS_OFFLINE && hasEditorAccess}>
            <Button
              icon={
                <span className="material-symbols-outlined">
                  space_dashboard
                </span>
              }
              className="sb-dock-page-button"
              label="Dashboard"
              outlined
              onClick={() => navigate('/')}
              aria-label="Dashboard Page"
            />
            <Button
              icon={
                <span className="material-symbols-outlined">border_color</span>
              }
              className="sb-dock-page-button"
              label="Topology Editor"
              outlined
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
        <If condition={!process.env.IS_OFFLINE}>
          <Button
            outlined
            icon="pi pi-bell"
            size="large"
            onClick={e => overlayRef.current?.toggle(e)}
            pt={{
              icon: {
                className: 'p-overlay-badge',
                children: (
                  <If condition={notificationStore.unreadMessages > 0}>
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
            outlined
            icon="pi pi-calendar"
            size="large"
            tooltip="Lab Schedule"
            tooltipOptions={{position: 'bottom'}}
            onClick={() => setCalendarOpen(true)}
            aria-label="Calendar"
          />
        </If>
        <Button
          outlined
          icon="pi pi-info-circle"
          size="large"
          tooltip="Credits"
          tooltipOptions={{position: 'bottom'}}
          onClick={() => setCreditsOpen(true)}
          aria-label="Credits"
        />
        <If condition={!process.env.IS_OFFLINE}>
          <Button
            outlined
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

      <If condition={!process.env.IS_OFFLINE}>
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
