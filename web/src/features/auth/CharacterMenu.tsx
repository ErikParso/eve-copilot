import { useState } from 'react';
import { useAtomValue } from 'jotai';
import {
  Avatar,
  Box,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { portraitUrl } from '@/api/character';
import { securityColor } from '@/data/sde';
import { formatNumber } from '@/utils/format';
import { characterStatusAtom } from './atoms';
import { useAuth } from './useAuth';

function ageSeconds(fetchedAt: number): number {
  return Math.max(0, Math.round((Date.now() - fetchedAt) / 1000));
}

/** Avatar button + dropdown with the active character's live status. */
export function CharacterMenu() {
  const { active, characters, login, logout, setActive } = useAuth();
  const status = useAtomValue(characterStatusAtom);
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);

  if (!active) return null;

  const close = () => setAnchor(null);
  const others = characters.filter((c) => c.characterId !== active.characterId);

  return (
    <>
      <Tooltip title={active.name} arrow>
        <IconButton onClick={(e) => setAnchor(e.currentTarget)} size="small" sx={{ p: 0.5 }}>
          <Avatar src={portraitUrl(active.characterId)} sx={{ width: 32, height: 32 }} />
        </IconButton>
      </Tooltip>

      <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
        <Box sx={{ px: 2, py: 1, minWidth: 240 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {active.name}
          </Typography>

          {status ? (
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <FiberManualRecordIcon
                  sx={{ fontSize: 10, color: status.online ? 'success.main' : 'text.disabled' }}
                />
                <Typography variant="caption" color="text.secondary">
                  {status.online ? 'Online' : 'Offline'}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  System:
                </Typography>
                <Typography variant="caption">{status.systemName ?? '—'}</Typography>
                {status.security !== null && (
                  <Typography
                    variant="caption"
                    sx={{ color: securityColor(status.security), fontWeight: 600 }}
                  >
                    {formatNumber(status.security, 1)}
                  </Typography>
                )}
              </Box>

              <Typography variant="caption" color="text.secondary">
                Ship: <Box component="span" sx={{ color: 'text.primary' }}>{status.shipTypeName ?? '—'}</Box>
              </Typography>

              <Typography variant="caption" color="text.disabled">
                updated {ageSeconds(status.fetchedAt)} s ago
              </Typography>
            </Stack>
          ) : (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Loading status…
            </Typography>
          )}
        </Box>

        <Divider />

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
