import React, {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

import {createBrowserRouter, RouterProvider} from 'react-router';

import App from '@sb/app';
import ErrorPage from '@sb/components/error-page/error-page';

import '@sb/theme/sb-base.sass';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider
      router={createBrowserRouter([
        {
          path: '*',
          element: <App />,
          errorElement: <ErrorPage isVisible={true} />,
        },
      ])}
    />
  </StrictMode>,
);
