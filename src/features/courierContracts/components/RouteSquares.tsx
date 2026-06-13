import { Box, Tooltip } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { securityColor } from '@/data/sde';
import { formatNumber } from '@/utils/format';
import type { RouteSystem } from '../types';

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
// Recent ship kills (last hour) at or above which a system is flagged with a
// skull — a likely gank/gate-camp hotspot.
const SKULL_KILL_THRESHOLD = 10;

const MARKER_LABEL: Record<RouteMarker, string> = {
  current: 'Current location — ',
  pickup: 'Pickup — ',
  dropoff: 'Dropoff — ',
};

function systemTooltip(system: RouteSystem, marker?: RouteMarker): string {
  const prefix = marker ? MARKER_LABEL[marker] : '';
  const danger = system.shipKills >= SKULL_KILL_THRESHOLD ? ' ☠ gank risk' : '';
  return `${prefix}${system.name} · sec ${formatNumber(system.security, 1)} · ${formatNumber(
    system.shipKills,
    0,
  )} kills/h${danger}`;
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
        const title = systemTooltip(node.system, node.marker);

        if (node.marker) {
          return (
            <Tooltip key={`${node.system.systemId}-${i}`} arrow title={title}>
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
                {node.marker === 'current' ? (
                  <Box
                    sx={{ width: SQUARE - 6, height: SQUARE - 6, borderRadius: '50%', bgcolor: '#161b22' }}
                  />
                ) : node.marker === 'pickup' ? (
                  <ArrowUpwardIcon sx={{ fontSize: SQUARE - 2, color: '#161b22' }} />
                ) : (
                  <ArrowDownwardIcon sx={{ fontSize: SQUARE - 2, color: '#161b22' }} />
                )}
              </Box>
            </Tooltip>
          );
        }

        return (
          <Tooltip key={`${node.system.systemId}-${i}`} arrow title={title}>
            <Box sx={{ width: SQUARE, height: SQUARE, bgcolor: color }} />
          </Tooltip>
        );
      })}
    </Box>
  );
}
