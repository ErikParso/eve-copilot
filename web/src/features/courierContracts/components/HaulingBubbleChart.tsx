import { useState, useMemo, useRef, useEffect } from 'react';
import { Box, Paper, Typography, useTheme, Tooltip, Divider, useMediaQuery } from '@mui/material';
import type { ResultCard } from '../combined';
import { formatIskMillions, formatVolume } from '@/utils/format';

interface HaulingBubbleChartProps {
  rows: ResultCard[];
  onBubbleClick: (key: string) => void;
}

interface ChartItem {
  key: string;
  name: string;
  type: 'Courier' | 'Arbitrage';
  jumps: number;
  profit: number;
  volume: number;
  attractivity: number;
  isPinned?: boolean;
}

export function HaulingBubbleChart({ rows, onBubbleClick }: HaulingBubbleChartProps) {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [dimensions, setDimensions] = useState({ width: 800, height: 200 });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setDimensions({ width, height });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const { width, height } = dimensions;

  // Filter and extract plot-friendly items
  const chartItems = useMemo<ChartItem[]>(() => {
    const items: ChartItem[] = [];
    for (const card of rows) {
      if (card.kind === 'courier') {
        const jumps = card.row.totalJumps;
        if (jumps === null || jumps === undefined) continue;
        items.push({
          key: card.key,
          name: `Package to ${card.row.dropoff.systemName ?? 'Unknown'}`,
          type: 'Courier',
          jumps,
          profit: card.row.reward,
          volume: card.row.volume,
          attractivity: card.row.attractivity,
        });
      } else if (card.kind === 'pinned-courier') {
        const jumps = card.row.totalJumps;
        if (jumps === null || jumps === undefined) continue;
        items.push({
          key: card.key,
          name: `Package to ${card.row.dropoff.systemName ?? 'Unknown'}`,
          type: 'Courier',
          jumps,
          profit: card.row.reward,
          volume: card.row.volume,
          attractivity: 0,
          isPinned: true,
        });
      } else if (card.kind === 'arbitrage') {
        const jumps = card.row.totalJumps;
        if (jumps === null || jumps === undefined) continue;
        items.push({
          key: card.key,
          name: card.row.itemName,
          type: 'Arbitrage',
          jumps,
          profit: card.row.profit,
          volume: card.row.totalVolume,
          attractivity: card.row.attractivity,
        });
      } else if (card.kind === 'pinned-arbitrage') {
        const jumps = card.row.totalJumps;
        if (jumps === null || jumps === undefined) continue;
        items.push({
          key: card.key,
          name: card.row.itemName,
          type: 'Arbitrage',
          jumps,
          profit: card.row.profit,
          volume: card.row.totalVolume,
          attractivity: 0,
          isPinned: true,
        });
      }
    }
    // Sort ascending by profit so bubbles with higher profit are rendered last (drawn on top)
    return items.sort((a, b) => a.profit - b.profit);
  }, [rows]);

  // Dimensions are measured dynamically
  const padding = isMobile 
    ? { top: 20, right: 20, bottom: 40, left: 60 }
    : { top: 20, right: 30, bottom: 40, left: 70 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Extents for scales
  const extents = useMemo(() => {
    if (chartItems.length === 0) {
      return { maxJumps: 10, maxProfit: 10_000_000, minVolume: 1, maxVolume: 10 };
    }

    const jumpsList = chartItems.map((d) => d.jumps);
    const profitList = chartItems.map((d) => d.profit);
    const volumeList = chartItems.map((d) => d.volume);

    return {
      maxJumps: Math.max(5, ...jumpsList),
      maxProfit: Math.max(10_000_000, ...profitList),
      minVolume: Math.min(...volumeList),
      maxVolume: Math.max(...volumeList),
    };
  }, [chartItems]);

  // Scaling functions
  const getX = (jumps: number) => {
    return padding.left + (jumps / extents.maxJumps) * plotWidth;
  };

  const getY = (profit: number) => {
    // Invert Y axis: higher profit is closer to top (which is Y=padding.top)
    return padding.top + plotHeight - (profit / extents.maxProfit) * plotHeight;
  };

  const getRadius = (volume: number) => {
    const minRadius = isMobile ? 8 : 7;
    const maxRadius = isMobile ? 22 : 19;

    if (extents.maxVolume === extents.minVolume) {
      return (minRadius + maxRadius) / 2;
    }

    // Use logarithmic scale for volume because cargo volumes vary by orders of magnitude (e.g. 1 to 100,000 m3)
    const logMin = Math.log(extents.minVolume + 1);
    const logMax = Math.log(extents.maxVolume + 1);
    const logVal = Math.log(volume + 1);

    const ratio = (logVal - logMin) / (logMax - logMin);
    return minRadius + ratio * (maxRadius - minRadius);
  };

  // Color generator
  const getBubbleColor = (score: number) => {
    const hue = Math.max(0, Math.min(100, score)) * 1.2; // 0 → red, 120 → green
    return `hsl(${hue}, 70%, 45%)`;
  };

  // Ticks for axis
  const xTicks = useMemo(() => {
    const ticksCount = 6;
    const ticks = [];
    const step = extents.maxJumps / ticksCount;
    for (let i = 0; i <= ticksCount; i++) {
      ticks.push(Math.round(i * step));
    }
    return Array.from(new Set(ticks));
  }, [extents.maxJumps]);

  const yTicks = useMemo(() => {
    const ticksCount = 4;
    const ticks = [];
    const step = extents.maxProfit / ticksCount;
    for (let i = 0; i <= ticksCount; i++) {
      ticks.push(i * step);
    }
    return ticks;
  }, [extents.maxProfit]);

  const formatCompactIsk = (val: number) => {
    if (val === 0) return '0 ISK';
    if (val >= 1e9) return `${(val / 1e9).toFixed(1)}B ISK`;
    if (val >= 1e6) return `${(val / 1e6).toFixed(0)}M ISK`;
    if (val >= 1e3) return `${(val / 1e3).toFixed(0)}K ISK`;
    return `${val} ISK`;
  };

  const handleMouseLeave = () => {
    setHoveredKey(null);
  };

  if (chartItems.length === 0) {
    return (
      <Paper
        variant="outlined"
        sx={{
          p: 4,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          bgcolor: 'background.paper',
          borderRadius: 2,
          minHeight: 200,
        }}
      >
        <Typography color="text.secondary" variant="body1">
          No routing opportunities available to display in the graph. Check your filters.
        </Typography>
      </Paper>
    );
  }

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        overflow: 'visible',
        width: '100%',
        height: '100%',
      }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        style={{ display: 'block', overflow: 'visible' }}
      >
          {/* Grid lines & Axes */}
          <g>
            {/* Y Grid lines */}
            {yTicks.map((val, i) => {
              const y = getY(val);
              return (
                <g key={`y-grid-${i}`}>
                  <line
                    x1={padding.left}
                    y1={y}
                    x2={width - padding.right}
                    y2={y}
                    stroke={theme.palette.divider}
                    strokeWidth={1}
                    strokeDasharray={val === 0 ? 'none' : '3,3'}
                  />
                  <text
                    x={padding.left - 12}
                    y={y}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fill={theme.palette.text.secondary}
                    fontSize="11px"
                    fontFamily="monospace"
                  >
                    {formatCompactIsk(val)}
                  </text>
                </g>
              );
            })}

            {/* X Grid lines */}
            {xTicks.map((val, i) => {
              const x = getX(val);
              return (
                <g key={`x-grid-${i}`}>
                  <line
                    x1={x}
                    y1={padding.top}
                    x2={x}
                    y2={height - padding.bottom}
                    stroke={theme.palette.divider}
                    strokeWidth={1}
                    strokeDasharray={val === 0 ? 'none' : '3,3'}
                  />
                  <text
                    x={x}
                    y={height - padding.bottom + 16}
                    textAnchor="middle"
                    fill={theme.palette.text.secondary}
                    fontSize="11px"
                    fontFamily="monospace"
                  >
                    {val}
                  </text>
                </g>
              );
            })}

          </g>

          {/* Bubbles */}
          <g>
            {chartItems.map((item) => {
              const cx = getX(item.jumps);
              const cy = getY(item.profit);
              const baseRadius = getRadius(item.volume);
              const isHovered = hoveredKey === item.key;
              const r = isHovered ? baseRadius + 3 : baseRadius;
              
              // Pinned gets max attractivity green color, normal gets attractivity color
              const color = item.isPinned ? getBubbleColor(100) : getBubbleColor(item.attractivity);
              const strokeColor = '#ffffff';
              const strokeWidth = isHovered ? 2 : 1;

              return (
                <Tooltip
                  key={item.key}
                  arrow
                  placement="top"
                  slotProps={{
                    tooltip: {
                      sx: {
                        bgcolor: 'background.paper',
                        color: 'text.primary',
                        border: '1px solid',
                        borderColor: 'divider',
                        boxShadow: '0 6px 20px rgba(0, 0, 0, 0.4)',
                        p: 1.5,
                        borderRadius: 1.5,
                        minWidth: 200,
                        '& .MuiTooltip-arrow': {
                          color: 'background.paper',
                          '&::before': {
                            border: '1px solid',
                            borderColor: 'divider',
                          },
                        },
                      },
                    },
                  }}
                  title={
                    <Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                        <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase' }}>
                          {item.isPinned ? `📌 Pinned ${item.type}` : item.type}
                        </Typography>
                        <Box
                          sx={{
                            px: 0.75,
                            py: 0.25,
                            borderRadius: 0.5,
                            bgcolor: item.isPinned ? 'primary.main' : getBubbleColor(item.attractivity),
                            color: item.isPinned ? '#ffffff' : '#0d1117',
                            fontWeight: 700,
                            fontSize: '0.75rem',
                          }}
                        >
                          {item.isPinned ? 'ACTIVE' : `${item.attractivity} Attractivity`}
                        </Box>
                      </Box>
                      <Typography variant="body2" sx={{ fontWeight: 700, mb: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.name}
                      </Typography>
                      <Divider sx={{ mb: 1 }} />
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                          <Typography variant="caption" color="text.secondary">Effort</Typography>
                          <Typography variant="caption" sx={{ fontWeight: 600 }}>{item.jumps} jumps</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                          <Typography variant="caption" color="text.secondary">Profit / Reward</Typography>
                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'primary.main' }}>
                            {formatIskMillions(item.profit)}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                          <Typography variant="caption" color="text.secondary">Cargo Volume</Typography>
                          <Typography variant="caption" sx={{ fontWeight: 600 }}>{formatVolume(item.volume)}</Typography>
                        </Box>
                      </Box>
                    </Box>
                  }
                >
                  <g
                    style={{ cursor: 'pointer' }}
                    onClick={() => onBubbleClick(item.key)}
                    onMouseEnter={() => setHoveredKey(item.key)}
                    onMouseLeave={handleMouseLeave}
                  >
                    {/* Outer glow ring for hovered item */}
                    {isHovered && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={r + 4}
                        fill="none"
                        stroke={color}
                        strokeWidth={2}
                        opacity={0.4}
                        style={{ transition: 'all 0.15s ease' }}
                      />
                    )}

                    {/* Main Bubble */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill={color}
                      fillOpacity={isHovered ? 0.95 : 0.75}
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      style={{ transition: 'all 0.15s ease' }}
                    />

                    {/* Attractivity index label inside the bubble (skip for pinned) */}
                    {!item.isPinned && baseRadius >= 9 && (
                      <text
                        x={cx}
                        y={cy}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="#0d1117"
                        fontSize={baseRadius < 12 ? '8.5px' : '10px'}
                        fontWeight="800"
                        pointerEvents="none"
                      >
                        {item.attractivity}
                      </text>
                    )}

                    {/* Push pin icon inside the bubble for pinned items */}
                    {item.isPinned && (
                      <path
                        d="M16,9V4H8v5c0,1.66-1.34,3-3,3v2h5.97v7l1,1l1-1v-7H19v-2C17.34,12,16,10.66,16,9z"
                        transform={`translate(${cx - 6}, ${cy - 6}) scale(0.5)`}
                        fill="#0d1117"
                        pointerEvents="none"
                      />
                    )}
                  </g>
                </Tooltip>
              );
            })}
          </g>
        </svg>
    </Box>
  );
}
