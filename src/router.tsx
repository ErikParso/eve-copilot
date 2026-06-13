import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CourierContractsPage } from './features/courierContracts/CourierContractsPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/couriers" replace /> },
      { path: 'couriers', element: <CourierContractsPage /> },
    ],
  },
]);
