import { AppBar, Box, Button, Container, Toolbar, Typography } from '@mui/material';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import { Link as RouterLink, Outlet, useLocation } from 'react-router-dom';
import { AuthControls } from '@/features/auth/AuthControls';
import { useCharacterStatusPoller } from '@/features/auth/useCharacterStatusPoller';
import { useCharacterWalletPoller } from '@/features/auth/useCharacterWalletPoller';
import { useHaulingSearchController } from '@/features/courierContracts/useHaulingSearchController';

interface NavItem {
  label: string;
  to: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Hauling', to: '/couriers' },
];

/** App shell: top navigation bar + routed page content. */
export function Layout() {
  const { pathname } = useLocation();
  useCharacterStatusPoller();
  useCharacterWalletPoller();
  useHaulingSearchController();

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="sticky" elevation={0} sx={{ bgcolor: 'background.paper' }}>
        <Toolbar>
          <RocketLaunchIcon sx={{ mr: 1, color: 'primary.main' }} />
          <Typography variant="h6" component="div" sx={{ fontWeight: 700, mr: 4 }}>
            EVE Copilot
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {NAV_ITEMS.map((item) => (
              <Button
                key={item.to}
                component={RouterLink}
                to={item.to}
                color={pathname.startsWith(item.to) ? 'primary' : 'inherit'}
              >
                {item.label}
              </Button>
            ))}
          </Box>

          <Box sx={{ flexGrow: 1 }} />



          <AuthControls />
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: 3, flex: 1 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
