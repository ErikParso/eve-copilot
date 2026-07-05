import { Box, Tooltip, alpha } from '@mui/material';
import type { SvgIconComponent } from '@mui/icons-material';
import ShoppingCartOutlinedIcon from '@mui/icons-material/ShoppingCartOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';

/** Shared four-stage lifecycle of a pinned opportunity (haul / package / courier). */
export type Stage = 'planning' | 'secured' | 'transit' | 'executed';

interface StageMeta {
  label: string;
  Icon: SvgIconComponent;
  /** Lifecycle accent — deliberately distinct from the card's profit-vs-baseline
   *  border colour, so the two signals never collide. */
  color: string;
  tooltip: string;
}

const STAGE_META: Record<Stage, StageMeta> = {
  planning: {
    label: 'Plan',
    Icon: ShoppingCartOutlinedIcon,
    color: '#7d8996',
    tooltip: 'Planning — buy / accept at the source to lock this in.',
  },
  secured: {
    label: 'Secured',
    Icon: Inventory2OutlinedIcon,
    color: '#f0b429',
    tooltip: 'Secured — bought/accepted and waiting at the pickup. Fly there and load it.',
  },
  transit: {
    label: 'In transit',
    Icon: LocalShippingOutlinedIcon,
    color: '#4dd0e1',
    tooltip: 'In transit — cargo loaded, en route to the drop-off.',
  },
  executed: {
    label: 'Done',
    Icon: CheckCircleOutlineIcon,
    color: '#56d364',
    tooltip: 'Delivered.',
  },
};

/**
 * Compact stage pill (icon + word) for a pinned card's header. Lives entirely
 * inside the header — it never touches the card border, which carries the
 * separate profit-vs-baseline signal.
 */
export function StageIndicator({ stage }: { stage: Stage }) {
  const { label, Icon, color, tooltip } = STAGE_META[stage];
  return (
    <Tooltip title={tooltip} arrow>
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.75,
          py: 0.375,
          borderRadius: 5,
          fontSize: 11,
          fontWeight: 700,
          lineHeight: 1,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          whiteSpace: 'nowrap',
          cursor: 'help',
          color,
          bgcolor: alpha(color, 0.14),
          border: '1px solid',
          borderColor: alpha(color, 0.38),
        }}
      >
        <Icon sx={{ fontSize: 14 }} />
        {label}
      </Box>
    </Tooltip>
  );
}
