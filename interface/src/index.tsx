import React, {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

import {createBrowserRouter, RouterProvider} from 'react-router';

import App from '@sb/app';
import ErrorPage from '@sb/components/error-page/error-page';

import '@sb/theme/sb-base.sass';

/*
 * We want to register the workbox service worker before loading the web-app.
 */
if (process.env.NODE_ENV === 'production') {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/service-worker.js')
        .then(registration => {
          console.log('[SW] Worker registered: ', registration);
        })
        .catch(registrationError => {
          console.error('[SW] Worker registration failed: ', registrationError);
        });
    });
  }
}

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
  </StrictMode>
);
