import { useEffect, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { Box, Tooltip } from '@mui/material';
import { styled, useTheme } from '@mui/material/styles';
import { keyframes } from '@emotion/react';
import { companionBusyAtom, companionMutedAtom } from '../atoms';
import { onSpeakingChange, stopSpeaking } from '../voice';

// A neural-chip reactor: a small central chip (with pins) inside a rotating HUD
// frame, with branched, asymmetric PCB traces radiating outward — varied nodes,
// junction dots and pads — and light pulses flowing along the traces. Four states:
//   • standby  — dim glow, slow pulses flowing OUT, nodes softly blinking
//   • thinking — purple, pulses flowing IN (converging on the chip), while waiting
//   • talking  — bright, fast pulses racing OUT, nodes flaring
//   • disabled — grey, frozen, no pulses
// Click toggles disabled (mute).

type OrbState = 'disabled' | 'standby' | 'thinking' | 'talking';

// Deterministic PRNG so the (random-looking) layout is stable across renders.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const f = (n: number) => n.toFixed(1);

interface Seg {
  d: string;
  delay: number;
  w: number;
}
interface Node {
  x: number;
  y: number;
  r: number;
  delay: number;
}
interface Pt {
  x: number;
  y: number;
}
interface Built {
  segs: Seg[];
  nodes: Node[];
  dots: Pt[];
  pads: Pt[];
}

// Recursively grow branched traces from the chip outward, up to 2 levels deep.
function build(): Built {
  const rng = makeRng(23);
  const segs: Seg[] = [];
  const nodes: Node[] = [];
  const dots: Pt[] = [];
  const pads: Pt[] = [];
  let idx = 0;
  let count = 0;
  const MAX = 34;

  const grow = (sx: number, sy: number, a: number, depth: number) => {
    if (count >= MAX) return;
    const L = depth === 0 ? 9 + rng() * 6 : depth === 1 ? 6 + rng() * 5 : 4 + rng() * 3;
    const jSign = rng() < 0.5 ? 1 : -1;
    const jLen = 2 + rng() * 4;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const bx = sx + dx * L;
    const by = sy + dy * L;
    const px = -dy * jSign;
    const py = dx * jSign;
    const ex = bx + px * jLen;
    const ey = by + py * jLen;

    segs.push({ d: `M ${f(sx)} ${f(sy)} L ${f(bx)} ${f(by)} L ${f(ex)} ${f(ey)}`, delay: idx * 0.12, w: 1.0 - depth * 0.22 });
    dots.push({ x: bx, y: by });
    nodes.push({ x: ex, y: ey, r: 2.1 - depth * 0.5, delay: idx * 0.14 });
    if (rng() < 0.32) pads.push({ x: ex, y: ey });
    idx++;
    count++;

    if (depth < 2) {
      const branches = depth === 0 ? (rng() < 0.7 ? 1 : 0) + (rng() < 0.45 ? 1 : 0) : rng() < 0.5 ? 1 : 0;
      for (let k = 0; k < branches; k++) {
        const spread = (rng() < 0.5 ? -1 : 1) * (0.4 + rng() * 0.6);
        grow(ex, ey, a + spread, depth + 1);
      }
    }
  };

  const N = 13;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const r0 = 10;
    grow(50 + Math.cos(a) * r0, 50 + Math.sin(a) * r0, a, 0);
  }
  return { segs, nodes, dots, pads };
}
const NET = build();

// HUD frame tick marks around the outer ring.
const TICKS = Array.from({ length: 24 }, (_, i) => {
  const a = (i / 24) * Math.PI * 2;
  const long = i % 3 === 0;
  const r1 = long ? 43 : 44.5;
  return {
    x1: 50 + Math.cos(a) * r1,
    y1: 50 + Math.sin(a) * r1,
    x2: 50 + Math.cos(a) * 46,
    y2: 50 + Math.sin(a) * 46,
  };
});

// Chip pins: 3 short stubs on each of the 4 sides.
const PINS: { x1: number; y1: number; x2: number; y2: number }[] = [];
for (const off of [-4, 0, 4]) {
  PINS.push({ x1: 50 + off, y1: 43, x2: 50 + off, y2: 40 }); // top
  PINS.push({ x1: 50 + off, y1: 57, x2: 50 + off, y2: 60 }); // bottom
  PINS.push({ x1: 43, y1: 50 + off, x2: 40, y2: 50 + off }); // left
  PINS.push({ x1: 57, y1: 50 + off, x2: 60, y2: 50 + off }); // right
}

const flowOut = keyframes`from { stroke-dashoffset: 0; } to { stroke-dashoffset: -100; }`;
const flowIn = keyframes`from { stroke-dashoffset: 0; } to { stroke-dashoffset: 100; }`;
const corePulse = keyframes`0%, 100% { opacity: 0.72; } 50% { opacity: 1; }`;
const nodeBlink = keyframes`0%, 100% { opacity: 0.3; } 50% { opacity: 1; }`;
const spin = keyframes`from { transform: rotate(0); } to { transform: rotate(360deg); }`;

const Svg = styled('svg')`
  display: block;
  overflow: visible;
  cursor: pointer;
  filter: drop-shadow(0 0 4px currentColor);
  transition: color 0.35s ease, filter 0.35s ease;

  & .frame {
    transform-box: fill-box;
    transform-origin: center;
    animation: ${spin} 44s linear infinite;
  }
  & .pulse {
    stroke-dasharray: 5 95;
    animation: ${flowOut} 3s linear infinite;
  }
  & .node {
    animation: ${nodeBlink} 2.6s ease-in-out infinite;
  }
  & .core {
    animation: ${corePulse} 3.4s ease-in-out infinite;
  }

  &[data-state='thinking'] .frame {
    animation-duration: 12s;
  }
  &[data-state='thinking'] .pulse {
    animation: ${flowIn} 1.5s linear infinite;
    stroke-dasharray: 6 94;
  }
  &[data-state='thinking'] .node {
    animation-duration: 1.2s;
  }
  &[data-state='thinking'] .core {
    animation-duration: 1s;
  }

  &[data-state='talking'] .pulse {
    animation-duration: 1.15s;
    stroke-dasharray: 8 92;
  }
  &[data-state='talking'] .node {
    animation-duration: 0.9s;
  }
  &[data-state='talking'] .core {
    animation-duration: 0.8s;
  }

  &[data-state='disabled'] {
    filter: none;
  }
  &[data-state='disabled'] .frame {
    animation: none;
  }
  &[data-state='disabled'] .pulse {
    display: none;
  }
  &[data-state='disabled'] .node,
  &[data-state='disabled'] .core {
    animation: none;
    opacity: 0.5;
  }
`;

export function CompanionOrb() {
  const theme = useTheme();
  const [muted, setMuted] = useAtom(companionMutedAtom);
  const busy = useAtomValue(companionBusyAtom);
  const [talking, setTalking] = useState(false);

  useEffect(() => onSpeakingChange(setTalking), []);

  const state: OrbState = muted ? 'disabled' : talking ? 'talking' : busy ? 'thinking' : 'standby';
  const color =
    state === 'disabled'
      ? theme.palette.text.disabled
      : state === 'thinking'
        ? '#b388ff'
        : state === 'talking'
          ? theme.palette.primary.light
          : theme.palette.primary.main;

  const title =
    state === 'disabled'
      ? 'Assistant disabled — click to enable'
      : state === 'thinking'
        ? 'Assistant thinking…'
        : state === 'talking'
          ? 'Assistant speaking'
          : 'Assistant on standby — click to disable';

  const toggle = () => {
    if (!muted) stopSpeaking();
    setMuted(!muted);
  };

  return (
    <Box sx={{ position: 'fixed', top: 76, right: 12, zIndex: (t) => t.zIndex.drawer + 2 }}>
      <Tooltip title={title} placement="left" arrow>
        <Svg
          data-state={state}
          viewBox="0 0 100 100"
          width={92}
          height={92}
          style={{ color }}
          onClick={toggle}
          role="button"
          aria-label={title}
        >
          {/* rotating HUD frame */}
          <g className="frame">
            <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="1 4" opacity="0.35" />
            {TICKS.map((t, i) => (
              <line key={`k${i}`} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="currentColor" strokeWidth="0.6" opacity="0.4" />
            ))}
          </g>

          {/* base traces (dim), width by depth */}
          {NET.segs.map((s, i) => (
            <path key={`t${i}`} d={s.d} fill="none" stroke="currentColor" strokeWidth={s.w} opacity="0.28" />
          ))}
          {/* junction dots */}
          {NET.dots.map((m, i) => (
            <circle key={`d${i}`} cx={m.x} cy={m.y} r="0.7" fill="currentColor" opacity="0.4" />
          ))}
          {/* PCB pads */}
          {NET.pads.map((p, i) => (
            <rect key={`pad${i}`} x={p.x - 1.3} y={p.y - 1.3} width="2.6" height="2.6" rx="0.5" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.5" />
          ))}
          {/* end nodes (blinking), varied size */}
          {NET.nodes.map((n, i) => (
            <circle
              key={`n${i}`}
              className="node"
              style={{ animationDelay: `${n.delay.toFixed(2)}s` }}
              cx={n.x}
              cy={n.y}
              r={n.r}
              fill="currentColor"
            />
          ))}
          {/* energy pulses along the traces */}
          {NET.segs.map((s, i) => (
            <path
              key={`p${i}`}
              className="pulse"
              style={{ animationDelay: `${s.delay.toFixed(2)}s` }}
              d={s.d}
              pathLength={100}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          ))}

          {/* chip pins */}
          {PINS.map((p, i) => (
            <line key={`pin${i}`} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke="currentColor" strokeWidth="0.8" opacity="0.55" />
          ))}
          {/* central chip core */}
          <g className="core">
            <rect x="43" y="43" width="14" height="14" rx="2.5" fill="currentColor" opacity="0.14" />
            <rect x="43" y="43" width="14" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <rect x="46.5" y="46.5" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.7" />
            <rect x="48.5" y="48.5" width="3" height="3" rx="0.6" fill="currentColor" />
          </g>
        </Svg>
      </Tooltip>
    </Box>
  );
}
