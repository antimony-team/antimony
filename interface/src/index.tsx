import React, {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

import {RouterProvider} from 'react-router';

import {SBRounter} from '@sb/routes';

import '@sb/theme/sb-base.sass';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={SBRounter} />
  </StrictMode>,
);
