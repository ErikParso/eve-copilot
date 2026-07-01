import { useState } from 'react';
import {
  AppBar,
  Box,
  Button,
  Container,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Toolbar,
  Typography,
} from '@mui/material';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import { Link as RouterLink, Outlet, useLocation } from 'react-router-dom';
import { AuthControls } from '@/features/auth/AuthControls';
import { useCharacterStatusPoller } from '@/features/auth/useCharacterStatusPoller';
import { useCharacterWalletPoller } from '@/features/auth/useCharacterWalletPoller';
import { useHaulingSearchController } from '@/features/courierContracts/useHaulingSearchController';
import { AdSenseScriptLoader } from './AdSenseScriptLoader';

interface NavItem {
  label: string;
  to: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Hauling', to: '/couriers' },
  { label: 'Market Data', to: '/market' },
  { label: 'Kill Data', to: '/kills' },
];

/** App shell: top navigation bar + routed page content. */
export function Layout() {
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  
  useCharacterStatusPoller();
  useCharacterWalletPoller();
  useHaulingSearchController();

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AdSenseScriptLoader />
      <AppBar position="sticky" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={() => setDrawerOpen(true)}
            sx={{ mr: 1, display: { xs: 'flex', md: 'none' } }}
          >
            <MenuIcon />
          </IconButton>

          <RocketLaunchIcon sx={{ mr: 1, color: 'primary.main' }} />
          <Typography variant="h6" component="div" sx={{ fontWeight: 700, mr: { xs: 1, md: 4 } }}>
            EVE Copilot
          </Typography>

          <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: 1 }}>
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

      <Drawer
        anchor="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{
          sx: {
            width: 260,
            bgcolor: 'background.paper',
            borderRight: '1px solid',
            borderColor: 'divider',
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <RocketLaunchIcon sx={{ mr: 1, color: 'primary.main' }} />
          <Typography variant="h6" sx={{ fontWeight: 700, flexGrow: 1 }}>
            EVE Copilot
          </Typography>
          <IconButton onClick={() => setDrawerOpen(false)} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
        <List sx={{ pt: 1 }}>
          {NAV_ITEMS.map((item) => (
            <ListItem key={item.to} disablePadding>
              <ListItemButton
                component={RouterLink}
                to={item.to}
                onClick={() => setDrawerOpen(false)}
                selected={pathname.startsWith(item.to)}
                sx={{
                  mx: 1,
                  borderRadius: 1,
                  '&.Mui-selected': {
                    color: 'primary.main',
                    bgcolor: 'action.selected',
                    '&:hover': {
                      bgcolor: 'action.hover',
                    },
                  },
                }}
              >
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{
                    fontWeight: pathname.startsWith(item.to) ? 700 : 500,
                  }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Drawer>

      <Container
        component="main"
        maxWidth="xl"
        sx={{
          py: 3,
          pb: 3,
          flex: 1,
        }}
      >
        <Outlet />
      </Container>
    </Box>
  );
}

