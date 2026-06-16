import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CourierContractsPage } from './features/courierContracts/CourierContractsPage';
import { CopilotPage } from './features/copilot/CopilotPage';
import { AuthCallbackPage } from './features/auth/AuthCallbackPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/couriers" replace /> },
      { path: 'couriers', element: <CourierContractsPage /> },
      { path: 'copilot', element: <CopilotPage /> },
      { path: 'auth/callback', element: <AuthCallbackPage /> },
    ],
  },
]);
