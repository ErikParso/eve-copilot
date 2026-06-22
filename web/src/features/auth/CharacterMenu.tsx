import { useState } from 'react';
import { useAtomValue } from 'jotai';
import {
  Avatar,
  Box,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
  Badge,
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { portraitUrl } from '@/api/character';
import { securityColor } from '@/data/sde';
import { formatIskMillions, formatNumber } from '@/utils/format';
import { characterStatusAtom, characterWalletAtom } from './atoms';
import { useAuth } from './useAuth';



/** Avatar button + dropdown with the active character's live status. */
export function CharacterMenu() {
  const { active, characters, login, logout, setActive } = useAuth();
  const status = useAtomValue(characterStatusAtom);
  const wallet = useAtomValue(characterWalletAtom);
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);

  if (!active) return null;

  const close = () => setAnchor(null);
  const others = characters.filter((c) => c.characterId !== active.characterId);

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ textAlign: 'right', display: { xs: 'none', sm: 'block' }, lineHeight: 1.25 }}>
          <Typography variant="body2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'flex-end' }}>
            {active.name}
            {status?.systemName && (
              <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary', fontSize: '0.75rem' }}>
                · {status.systemName}
                {status.security != null && (
                  <Box component="span" sx={{ color: securityColor(status.security), fontWeight: 600, ml: 0.5 }}>
                    ({formatNumber(status.security, 1)})
                  </Box>
                )}
              </Box>
            )}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>
            {wallet ? `${formatIskMillions(wallet.balance)}` : '—'}
          </Typography>
        </Box>
        <Tooltip title={active.name} arrow>
          <IconButton onClick={(e) => setAnchor(e.currentTarget)} size="small" sx={{ p: 0.5 }}>
            <Badge
              overlap="circular"
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              variant="dot"
              sx={{
                '& .MuiBadge-badge': {
                  backgroundColor: status?.online ? '#4caf50' : '#9e9e9e',
                  color: status?.online ? '#4caf50' : '#9e9e9e',
                  boxShadow: (theme) => `0 0 0 2px ${theme.palette.background.paper}`,
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  '&::after': status?.online ? {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    borderRadius: '50%',
                    animation: 'ripple 1.2s infinite ease-in-out',
                    border: '1px solid currentColor',
                    content: '""',
                  } : undefined,
                },
                '@keyframes ripple': {
                  '0%': {
                    transform: 'scale(.8)',
                    opacity: 1,
                  },
                  '100%': {
                    transform: 'scale(2.4)',
                    opacity: 0,
                  },
                },
              }}
            >
              <Avatar src={portraitUrl(active.characterId)} sx={{ width: 40, height: 40 }} />
            </Badge>
          </IconButton>
        </Tooltip>
      </Box>

      <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
        {others.map((c) => (
          <MenuItem
            key={c.characterId}
            onClick={() => {
              setActive(c.characterId);
              close();
            }}
          >
            <Avatar src={portraitUrl(c.characterId)} sx={{ width: 22, height: 22, mr: 1 }} />
            Switch to {c.name}
          </MenuItem>
        ))}

        <MenuItem
          onClick={() => {
            close();
            void login();
          }}
        >
          <PersonAddIcon fontSize="small" sx={{ mr: 1 }} />
          Add / switch character
        </MenuItem>

        <MenuItem
          onClick={() => {
            logout(active.characterId);
            close();
          }}
        >
          <LogoutIcon fontSize="small" sx={{ mr: 1 }} />
          Log out
        </MenuItem>
      </Menu>
    </>
  );
}
