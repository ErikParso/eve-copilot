import { AppBar, Box, Button, Container, IconButton, Toolbar, Tooltip, Typography } from '@mui/material';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import SettingsIcon from '@mui/icons-material/Settings';
import { useSetAtom } from 'jotai';
import { Link as RouterLink, Outlet, useLocation } from 'react-router-dom';
import { useSdeMeta } from '@/data/sdeContext';
import { AuthControls } from '@/features/auth/AuthControls';
import { useCharacterStatusPoller } from '@/features/auth/useCharacterStatusPoller';
import { useHaulingSearchController } from '@/features/courierContracts/useHaulingSearchController';
import { PreferencesDrawer } from '@/features/preferences/PreferencesDrawer';
import { preferencesOpenAtom } from '@/features/preferences/atoms';

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
  const openPrefs = useSetAtom(preferencesOpenAtom);
  useCharacterStatusPoller();
  useHaulingSearchController();

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

          <Tooltip title="Preferences" arrow>
            <IconButton color="inherit" onClick={() => openPrefs(true)} sx={{ mr: 1 }}>
              <SettingsIcon />
            </IconButton>
          </Tooltip>

          <AuthControls />
        </Toolbar>
      </AppBar>

      <PreferencesDrawer />

      <Container maxWidth="xl" sx={{ py: 3, flex: 1 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
