import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CourierContractsPage } from './features/courierContracts/CourierContractsPage';
import { AuthCallbackPage } from './features/auth/AuthCallbackPage';
import { MarketDataPage } from './features/marketData/MarketDataPage';
import { KillDataPage } from './features/killData/KillDataPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/couriers" replace /> },
      { path: 'couriers', element: <CourierContractsPage /> },
      { path: 'market', element: <MarketDataPage /> },
      { path: 'kills', element: <KillDataPage /> },
      { path: 'auth/callback', element: <AuthCallbackPage /> },
    ],
  },
]);
