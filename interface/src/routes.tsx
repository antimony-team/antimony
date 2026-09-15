import React from 'react';

import {observer} from 'mobx-react-lite';
import {createHashRouter} from 'react-router';

import App from '@sb/app';
import ErrorScreen from '@sb/components/error-screen/error-screen';
import EditorPage from '@sb/components/editor-page/editor-page';
import DashboardPage from '@sb/components/dashboard-page/dashboard-page';
import RouteErrorBoundary from '@sb/components/error-screen/route-error-boundary';
import {useAuthUser, useCollectionStore} from '@sb/lib/stores/root-store';

/**
 * Only allow admins or users with at least one accessible collection to use the editor.
 */
const EditorRoute = observer(() => {
  const authUser = useAuthUser();
  const collectionStore = useCollectionStore();

  if (!authUser.isAdmin && !collectionStore.hasAccessibleCollections) {
    return (
      <ErrorScreen code="403" message="You do not have access to this page" />
    );
  }

  return <EditorPage />;
});

export const SBRounter = createHashRouter([
  {
    element: <App />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {index: true, element: <DashboardPage />},
      {path: 'editor', element: <EditorRoute />},
      {
        path: '*',
        element: <ErrorScreen code="404" message="This page does not exist" />,
      },
    ],
  },
]);
