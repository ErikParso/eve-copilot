import { AppBar, Box, Button, Container, Toolbar, Tooltip, Typography } from '@mui/material';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import { Link as RouterLink, Outlet, useLocation } from 'react-router-dom';
import { useSdeMeta } from '@/data/sdeContext';
import { AuthControls } from '@/features/auth/AuthControls';
import { useCharacterStatusPoller } from '@/features/auth/useCharacterStatusPoller';

interface NavItem {
  label: string;
  to: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Hauling', to: '/couriers' },
  { label: 'Copilot', to: '/copilot' },
];

/** App shell: top navigation bar + routed page content. */
export function Layout() {
  const { pathname } = useLocation();
  const sdeMeta = useSdeMeta();
  useCharacterStatusPoller();

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="sticky" elevation={0} sx={{ bgcolor: 'background.paper' }}>
        <Toolbar>
          <RocketLaunchIcon sx={{ mr: 1, color: 'primary.main' }} />
          <Typography variant="h6" component="div" sx={{ fontWeight: 700, mr: 4 }}>
            EVE Multitool
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

          {sdeMeta && (
            <Tooltip
              title={`${sdeMeta.stationCount} stations · ${sdeMeta.systemCount} systems${
                sdeMeta.fromCache ? ' (from local cache)' : ' (fresh)'
              }`}
              arrow
            >
              <Typography variant="caption" color="text.secondary" sx={{ mr: 2 }}>
                SDE: {new Date(sdeMeta.fetchedAt).toLocaleDateString()}
              </Typography>
            </Tooltip>
          )}

          <AuthControls />
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 3, flex: 1 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
