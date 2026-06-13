import { Box, Stack, Tooltip, Typography } from '@mui/material';
import type { SecurityBand } from '@/data/sde';
import { formatNumber } from '@/utils/format';
import type { ContractEndpoint } from '../types';

const SECURITY_COLOR: Record<SecurityBand, string> = {
  high: '#5cb85c',
  low: '#f0ad4e',
  null: '#d9534f',
};

/** Pickup/dropoff cell: location name with its system and security status. */
export function LocationCell({ endpoint }: { endpoint: ContractEndpoint }) {
  if (!endpoint.resolved) {
    return (
      <Stack spacing={0}>
        <Typography variant="body2" noWrap>
          {endpoint.name}
        </Typography>
        <Tooltip title="Player structure — resolving its name requires an authenticated EVE login.">
          <Typography variant="caption" color="text.disabled">
            Unknown structure
          </Typography>
        </Tooltip>
      </Stack>
    );
  }

  const band = endpoint.securityBand;
  return (
    <Stack spacing={0}>
      <Typography variant="body2" noWrap title={endpoint.name}>
        {endpoint.name}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary" noWrap>
          {endpoint.systemName}
        </Typography>
        {endpoint.security !== null && band && (
          <Typography variant="caption" sx={{ color: SECURITY_COLOR[band], fontWeight: 600 }}>
            {formatNumber(endpoint.security, 1)}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
