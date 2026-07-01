import type { ReactNode } from 'react';
import { Box, Divider, Tooltip, Typography } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { securityColor } from '@/data/sde';
import { formatNumber } from '@/utils/format';
import type { RouteSystem } from '../types';
import { dangerColor } from './DangerCell';

export type RouteMarker = 'current' | 'pickup' | 'dropoff';

export interface RouteNode {
  system: RouteSystem;
  /** Pickup (arrow up) / dropoff (arrow down) endpoint marker, if any. */
  marker?: RouteMarker;
}

interface RouteSquaresProps {
  nodes: RouteNode[];
  align?: 'left' | 'right';
}

// Uniform square size for every system on the route (markers included).
const SQUARE = 11;
const MARKER_LABEL: Record<RouteMarker, string> = {
  current: 'Current location — ',
  pickup: 'Pickup — ',
  dropoff: 'Dropoff — ',
};

const killLabel = (n: number) => `${formatNumber(n, 0)} ${n === 1 ? 'kill' : 'kills'}`;

/**
 * Rich per-square tooltip: basic system info, this system's own danger index,
 * the kills-at-gates breakdown, and the exact-number calculation of the index.
 */
function SystemTooltip({ system, marker }: { system: RouteSystem; marker?: RouteMarker }) {
  const prefix = marker ? MARKER_LABEL[marker] : '';
  const gateKills: string[] = [];
  if (system.nextName) {
    gateKills.push(`${killLabel(system.gateKillsToNext)} at gate to ${system.nextName}`);
  }
  if (system.prevName) {
    gateKills.push(`${killLabel(system.gateKillsToPrev)} at gate to ${system.prevName}`);
  }

  return (
    <Box sx={{ py: 0.5 }}>
      <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
        {prefix}
        {system.name} · {system.securityBand}-sec {formatNumber(system.security, 1)}
      </Typography>

      <Typography variant="caption" sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'center' }}>
        <Box component="span" sx={{ color: 'text.secondary' }}>
          Danger
        </Box>
        <Box component="span" sx={{ fontWeight: 700, color: dangerColor(system.danger) }}>
          {system.danger}
        </Box>
        {system.gank && <Box component="span">· ☠ gank risk</Box>}
      </Typography>

      <Divider sx={{ my: 0.5 }} />

      {gateKills.length > 0 ? (
        gateKills.map((k, i) => (
          <Typography key={i} variant="caption" sx={{ display: 'block', lineHeight: 1.5 }}>
            {k}
          </Typography>
        ))
      ) : (
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
          No recent gate kills
        </Typography>
      )}

      <Divider sx={{ my: 0.5 }} />

      <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
        How this system's danger is calculated
      </Typography>
      {system.dangerSteps.map((step, i) => (
        <Typography key={i} variant="caption" sx={{ display: 'block', lineHeight: 1.5, color: 'text.secondary' }}>
          {step}
        </Typography>
      ))}
    </Box>
  );
}

/**
 * Visualises a route as a row of small squares, one per system, coloured by
 * EVE security status. The pickup system shows an up arrow, the dropoff a
 * down arrow.
 */
export function RouteSquares({ nodes, align = 'left' }: RouteSquaresProps) {
  if (nodes.length === 0) return null;

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '2px',
        mt: 0.5,
        maxWidth: 250,
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
      }}
    >
      {nodes.map((node, i) => {
        const color = securityColor(node.system.security);
        const title = <SystemTooltip system={node.system} marker={node.marker} />;
        const dangerous = node.system.gank;

        // Marker glyph takes priority; otherwise a skull for gank hotspots.
        let content: ReactNode = null;
        if (node.marker === 'current') {
          content = (
            <Box sx={{ width: SQUARE - 6, height: SQUARE - 6, borderRadius: '50%', bgcolor: '#161b22' }} />
          );
        } else if (node.marker === 'pickup') {
          content = <ArrowUpwardIcon sx={{ fontSize: SQUARE - 2, color: '#161b22' }} />;
        } else if (node.marker === 'dropoff') {
          content = <ArrowDownwardIcon sx={{ fontSize: SQUARE - 2, color: '#161b22' }} />;
        } else if (dangerous) {
          content = (
            <Box
              component="span"
              sx={{ fontSize: SQUARE, lineHeight: 1, color: '#161b22', fontWeight: 700 }}
            >
              ☠
            </Box>
          );
        }

        return (
          <Tooltip
            key={`${node.system.systemId}-${i}`}
            arrow
            title={title}
            slotProps={{ tooltip: { sx: { maxWidth: 320 } } }}
          >
            <Box
              sx={{
                width: SQUARE,
                height: SQUARE,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: color,
              }}
            >
              {content}
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}
