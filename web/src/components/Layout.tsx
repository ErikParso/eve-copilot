import { useEffect, useState } from 'react';
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
import { useCompanion } from '@/features/companion/useCompanion';
import { CompanionOrb } from '@/features/companion/components/CompanionOrb';
import { COMPANION_ENABLED } from '@/features/companion/config';
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

  // Dynamic SEO metadata updates (canonical url, Open Graph, and Twitter tags)
  useEffect(() => {
    const baseDomain = 'https://eve-online-copilot.hf.space';
    
    // Normalize path (in case of '/' redirecting to '/couriers')
    const normalizedPath = pathname === '/' ? '/couriers' : pathname;
    const currentUrl = `${baseDomain}${normalizedPath}`;

    // 1. Update/create canonical link tag
    let canonicalLink = document.querySelector('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.setAttribute('href', currentUrl);

    // 2. Update Open Graph and Twitter URL tags
    const ogUrlMeta = document.querySelector('meta[property="og:url"]');
    if (ogUrlMeta) ogUrlMeta.setAttribute('content', currentUrl);
    const twUrlMeta = document.querySelector('meta[property="twitter:url"]');
    if (twUrlMeta) twUrlMeta.setAttribute('content', currentUrl);

    // 3. Sync Open Graph and Twitter title and description from the current page state.
    // We wrap this in requestAnimationFrame to ensure the child route's own useEffect
    // has run and updated document.title and description.
    const handle = requestAnimationFrame(() => {
      const title = document.title;
      const ogTitleMeta = document.querySelector('meta[property="og:title"]');
      if (ogTitleMeta) ogTitleMeta.setAttribute('content', title);
      const twTitleMeta = document.querySelector('meta[property="twitter:title"]');
      if (twTitleMeta) twTitleMeta.setAttribute('content', title);

      const descMeta = document.querySelector('meta[name="description"]');
      const description = descMeta ? descMeta.getAttribute('content') : '';
      if (description) {
        const ogDescMeta = document.querySelector('meta[property="og:description"]');
        if (ogDescMeta) ogDescMeta.setAttribute('content', description);
        const twDescMeta = document.querySelector('meta[property="twitter:description"]');
        if (twDescMeta) twDescMeta.setAttribute('content', description);
      }
    });

    return () => cancelAnimationFrame(handle);
  }, [pathname]);
  
  useCharacterStatusPoller();
  useCharacterWalletPoller();
  useHaulingSearchController();
  useCompanion();

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

      {COMPANION_ENABLED && <CompanionOrb />}
    </Box>
  );
}

