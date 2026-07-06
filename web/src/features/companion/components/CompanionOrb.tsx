import { useEffect, useState, useRef } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { Box, Tooltip } from '@mui/material';
import { styled } from '@mui/material/styles';
import { keyframes } from '@emotion/react';
import { companionBusyAtom, companionMutedAtom, companionBottomOffsetAtom } from '../atoms';
import { onSpeakingChange, stopSpeaking } from '../voice';

type OrbState = 'disabled' | 'standby' | 'thinking' | 'talking';

// === PARTICLE SYSTEM DATA AND TYPES ===
interface Point {
  x: number;
  y: number;
}

const routes: Point[][] = [
  [{x:100,y:89},{x:100,y:50},{x:100,y:14}],
  [{x:94,y:89},{x:94,y:66},{x:78,y:50},{x:52,y:50}],
  [{x:106,y:89},{x:106,y:72},{x:122,y:56},{x:122,y:34}],
  [{x:100,y:111},{x:100,y:150},{x:100,y:186}],
  [{x:94,y:111},{x:94,y:138},{x:68,y:138},{x:68,y:162}],
  [{x:106,y:111},{x:106,y:132},{x:122,y:148},{x:122,y:172}],
  [{x:89,y:100},{x:50,y:100},{x:12,y:100}],
  [{x:89,y:94},{x:66,y:94},{x:66,y:72},{x:42,y:72},{x:28,y:58}],
  [{x:89,y:106},{x:66,y:106},{x:50,y:122},{x:28,y:122}],
  [{x:111,y:100},{x:150,y:100},{x:188,y:100}],
  [{x:111,y:94},{x:134,y:94},{x:134,y:68},{x:148,y:54}],
  [{x:111,y:106},{x:132,y:106},{x:132,y:130},{x:158,y:130},{x:158,y:152}],
  [{x:78,y:50},{x:78,y:26}],
  [{x:122,y:56},{x:138,y:56}],
  [{x:52,y:50},{x:38,y:36}],
  [{x:42,y:72},{x:42,y:54}],
  [{x:28,y:122},{x:28,y:148}],
  [{x:80,y:138},{x:80,y:150}],
  [{x:64,y:142},{x:64,y:168}],
  [{x:150,y:50},{x:150,y:34},{x:168,y:34}],
];

class Particle {
  route: Point[];
  pg: SVGGElement;
  progress: number;
  speed: number;
  sz: number;
  el: SVGCircleElement;

  constructor(route: Point[], pg: SVGGElement) {
    this.route = route;
    this.pg = pg;
    this.progress = Math.random();
    this.speed = 0.002 + Math.random() * 0.003;
    this.sz = 2.0 + Math.random() * 1.5;
    this.el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this.el.setAttribute('r', this.sz.toString());
    this.el.setAttribute('fill', 'var(--cy-b)');
    this.el.style.transition = 'none';
    pg.appendChild(this.el);
  }

  update(m: number) {
    this.progress += this.speed * m;
    if (this.progress >= 1) {
      this.progress = 0;
      if (Math.random() > 0.55) {
        this.route = routes[Math.floor(Math.random() * routes.length)];
      }
    }
    const p = this.route;
    const n = p.length - 1;
    const s = this.progress * n;
    const i = Math.min(Math.floor(s), n - 1);
    const t = s - i;
    const cx = p[i].x + (p[i + 1].x - p[i].x) * t;
    const cy = p[i].y + (p[i + 1].y - p[i].y) * t;
    this.el.setAttribute('cx', cx.toString());
    this.el.setAttribute('cy', cy.toString());
    this.el.setAttribute('opacity', (Math.sin(this.progress * Math.PI) * 0.85).toString());
  }

  destroy() {
    this.el.remove();
  }
}

// === KEYFRAMES ===
const sPulse = keyframes`0%, 100% { opacity: 0.12; } 50% { opacity: 0.4; }`;
const sPulseD = keyframes`0%, 100% { opacity: 0.45; } 50% { opacity: 1; }`;
const tPulse = keyframes`0%, 100% { opacity: 0.25; } 50% { opacity: 0.75; }`;
const tPulseD = keyframes`0%, 100% { opacity: 0.6; } 50% { opacity: 1; }`;
const tkP = keyframes`0%, 100% { opacity: 0.4; } 50% { opacity: 1; }`;
const nGlow = keyframes`0%, 100% { opacity: 0.45; } 50% { opacity: 1; }`;
const nGlowF = keyframes`0%, 100% { opacity: 0.55; } 50% { opacity: 1; }`;
const naF = keyframes`0% { opacity: 0.12; } 100% { opacity: 0.55; }`;
const rP = keyframes`0%, 100% { opacity: 0.12; } 50% { opacity: 0.35; }`;
const eM = keyframes`0% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -20; }`;
const vExp = keyframes`0% { r: 16px; opacity: 0.65; stroke-width: 1.8px; } 100% { r: 52px; opacity: 0; stroke-width: 0.3px; }`;
const coreHalo = keyframes`
  0%, 100% { transform: scale(0.85); opacity: 0.35; }
  50% { transform: scale(1.35); opacity: 0.9; }
`;

const Svg = styled('svg')`
  --cy: #00e5ff;
  --cy-d: #0a4858;
  --cy-m: #007a8a;
  --cy-b: #80f0ff;
  --bg: #020a12;
  --off-tr: #324252;
  --off-nd: #445669;
  --off-core: #293645;
  --off-cb: #384a5c;

  display: block;
  width: 100%;
  height: 100%;
  cursor: pointer;
  overflow: visible;

  /* === TRANSITIONS === */
  & .tr, & .pin-s {
    transition: stroke 0.8s ease, opacity 0.8s ease;
  }
  & .nd {
    transition: fill 0.8s ease, opacity 0.8s ease;
  }
  & .core-body, & .core-die {
    transition: fill 0.8s ease, stroke 0.8s ease;
  }
  & .core-glow {
    transition: opacity 0.8s ease;
  }
  & .na {
    transition: stroke 0.8s ease, opacity 0.8s ease;
  }
  & .die-l {
    transition: stroke 0.6s ease;
  }
  & .pad {
    transition: fill 0.8s ease;
  }
  & .nd-core-halo {
    transform-box: fill-box;
    transform-origin: center;
    animation: ${coreHalo} 2s ease-in-out infinite;
    stroke: var(--cy);
    transition: stroke 0.8s ease, opacity 0.8s ease;
  }

  /* === DISABLED === */
  &[data-state="disabled"] {
    & .tr { stroke: var(--off-tr); }
    & .nd { fill: var(--off-nd); }
    & .core-body { fill: #131b24; stroke: var(--off-cb); }
    & .core-die { fill: #0d141b; stroke: var(--off-core); }
    & .core-glow { opacity: 0; }
    & .core-dot { fill: var(--off-nd); opacity: 0.6; }
    & .core-dot-i { fill: var(--off-cb); }
    & .pin-s { stroke: var(--off-tr); }
    & .na { stroke: var(--off-tr); opacity: 0.25; }
    & .rng { stroke: var(--off-tr); opacity: 0.2; }
    & .ef { opacity: 0 !important; }
    & .die-l { stroke: #192430; }
    & .bg-gl { opacity: 0; }
    & .pad { fill: var(--off-nd); }
    & .align-dot { fill: #192430; }
    & .nd-core-halo { animation: none; stroke: var(--off-tr); opacity: 0.4; }
  }

  /* === STANDBY === */
  &[data-state="standby"] {
    & .tr { stroke: var(--cy-d); }
    & .nd { fill: var(--cy-m); }
    & .core-body { fill: #08161e; stroke: var(--cy-d); }
    & .core-die { fill: #050e16; stroke: #0a3040; }
    & .core-glow { animation: ${sPulse} 4s ease-in-out infinite; }
    & .core-dot { fill: var(--cy-m); animation: ${sPulseD} 4s ease-in-out infinite; }
    & .core-dot-i { fill: var(--cy); }
    & .pin-s { stroke: var(--cy-d); }
    & .na { stroke: var(--cy-d); opacity: 0.12; }
    & .rng { stroke: var(--cy-d); opacity: 0.15; }
    & .ef { opacity: 0 !important; }
    & .die-l { stroke: #0a2830; }
    & .bg-gl { opacity: 0.25; animation: ${sPulse} 4s ease-in-out infinite; }
    & .pad { fill: var(--cy-d); }
    & .align-dot { fill: #0a2830; }
    & .nd-core-halo { animation-duration: 3s; stroke: var(--cy-m); }
  }

  /* === THINKING === */
  &[data-state="thinking"] {
    & .tr { stroke: var(--cy-m); }
    & .nd { fill: var(--cy); animation: ${nGlow} 2s ease-in-out infinite; }
    & .core-body { fill: #0a1e28; stroke: var(--cy); }
    & .core-die { fill: #071620; stroke: var(--cy-d); }
    & .core-glow { animation: ${tPulse} 1.4s ease-in-out infinite; }
    & .core-dot { fill: var(--cy); animation: ${tPulseD} 1.4s ease-in-out infinite; }
    & .core-dot-i { fill: var(--cy-b); }
    & .pin-s { stroke: var(--cy-m); }
    & .na { stroke: var(--cy-m); opacity: 0.35; animation: ${naF} 2.2s ease-in-out infinite alternate; }
    & .rng { stroke: var(--cy-d); opacity: 0.25; animation: ${rP} 2.4s ease-in-out infinite; }
    & .ef { opacity: 0.5; animation: ${eM} 2.8s linear infinite; }
    & .die-l { stroke: #0e3842; }
    & .bg-gl { opacity: 0.45; animation: ${tPulse} 1.4s ease-in-out infinite; }
    & .pad { fill: var(--cy-m); }
    & .align-dot { fill: var(--cy-d); }
    & .nd-core-halo { animation-duration: 1.5s; stroke: var(--cy); }
  }

  /* === TALKING === */
  &[data-state="talking"] {
    & .tr { stroke: var(--cy); }
    & .nd { fill: var(--cy-b); animation: ${nGlowF} 0.7s ease-in-out infinite; }
    & .core-body { fill: #0e2830; stroke: var(--cy-b); }
    & .core-die { fill: #0a1e28; stroke: var(--cy); }
    & .core-glow { animation: ${tkP} 0.5s ease-in-out infinite; }
    & .core-dot { fill: var(--cy-b); }
    & .core-dot-i { fill: #fff; }
    & .pin-s { stroke: var(--cy); }
    & .na { stroke: var(--cy); opacity: 0.55; animation: ${naF} 0.7s ease-in-out infinite alternate; }
    & .rng { stroke: var(--cy); opacity: 0.35; animation: ${rP} 0.9s ease-in-out infinite; }
    & .ef { opacity: 0.85; animation: ${eM} 0.9s linear infinite; }
    & .die-l { stroke: #145868; }
    & .bg-gl { opacity: 0.65; }
    & .vw { animation: ${vExp} 0.7s ease-out infinite; }
    & .pad { fill: var(--cy); }
    & .align-dot { fill: var(--cy-d); }
    & .nd-core-halo { animation-duration: 0.8s; stroke: var(--cy-b); }
  }
`;

export function CompanionOrb() {
  const [muted, setMuted] = useAtom(companionMutedAtom);
  const busy = useAtomValue(companionBusyAtom);
  const [talking, setTalking] = useState(false);

  useEffect(() => onSpeakingChange(setTalking), []);

  const state: OrbState = muted ? 'disabled' : talking ? 'talking' : busy ? 'thinking' : 'standby';

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

  const svgRef = useRef<SVGSVGElement>(null);
  const ptclRef = useRef<SVGGElement>(null);
  const stateRef = useRef<OrbState>(state);
  const particlesRef = useRef<Particle[]>([]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Particle population update
  useEffect(() => {
    const ptclEl = ptclRef.current;
    if (!ptclEl) return;

    particlesRef.current.forEach(p => p.destroy());
    particlesRef.current = [];

    if (state === 'disabled') return;

    const count = state === 'standby' ? 6 : state === 'thinking' ? 16 : 24;
    for (let i = 0; i < count; i++) {
      const randomRoute = routes[Math.floor(Math.random() * routes.length)];
      particlesRef.current.push(new Particle(randomRoute, ptclEl));
    }
  }, [state]);

  // Animation loops
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    let animLoopId: number;
    let animRingsId: number;
    let voiceModId: number;
    let flickerTimeoutId: ReturnType<typeof setTimeout>;

    const animLoop = () => {
      const s = stateRef.current;
      const m = s === 'standby' ? 0.35 : s === 'thinking' ? 1.2 : s === 'talking' ? 2.2 : 0;
      particlesRef.current.forEach(p => p.update(m));
      animLoopId = requestAnimationFrame(animLoop);
    };
    animLoopId = requestAnimationFrame(animLoop);

    const animRings = () => {
      const s = stateRef.current;
      if (s !== 'disabled') {
        const sp = s === 'standby' ? 0.12 : s === 'thinking' ? 0.45 : 0.7;
        const now = Date.now();
        const rings = svgEl.querySelectorAll('.rng');
        rings.forEach((r, i) => {
          const ringEl = r as SVGElement;
          const d = i % 2 === 0 ? 1 : -1;
          ringEl.style.transformOrigin = '100px 100px';
          ringEl.style.transform = `rotate(${(now * 0.003 * sp * d * (1 + i * 0.5)) % 360}deg)`;
        });
      }
      animRingsId = requestAnimationFrame(animRings);
    };
    animRingsId = requestAnimationFrame(animRings);

    const flicker = () => {
      const s = stateRef.current;
      if (s === 'thinking' || s === 'talking') {
        const ch = s === 'talking' ? 0.09 : 0.035;
        const nodes = svgEl.querySelectorAll('.nd');
        nodes.forEach(n => {
          if (Math.random() < ch) {
            n.setAttribute('fill', s === 'talking' ? '#fff' : 'var(--cy-b)');
            setTimeout(() => n.removeAttribute('fill'), 80 + Math.random() * 160);
          }
        });
      }
      flickerTimeoutId = setTimeout(flicker, 90);
    };
    flickerTimeoutId = setTimeout(flicker, 90);

    const voiceMod = () => {
      const s = stateRef.current;
      if (s === 'talking') {
        const t = Date.now() * 0.006;
        const a = 0.3 + 0.7 * Math.abs(Math.sin(t * 2.1) * 0.3 + Math.sin(t * 3.4) * 0.25 + Math.sin(t * 5.8) * 0.2 + Math.random() * 0.12);
        const g = svgEl.querySelector('.core-glow') as SVGElement | null;
        if (g) {
          g.setAttribute('opacity', (0.25 + a * 0.7).toString());
          g.style.transformOrigin = '100px 100px';
          g.style.transform = `scale(${1 + a * 0.1})`;
        }
      }
      voiceModId = requestAnimationFrame(voiceMod);
    };
    voiceModId = requestAnimationFrame(voiceMod);

    return () => {
      cancelAnimationFrame(animLoopId);
      cancelAnimationFrame(animRingsId);
      cancelAnimationFrame(voiceModId);
      clearTimeout(flickerTimeoutId);
    };
  }, []);

  const bottomOffset = useAtomValue(companionBottomOffsetAtom);

  const bottomStyle =
    bottomOffset === 'expanded'
      ? { xs: 'calc(30vh + 32px)', md: '232px' }
      : bottomOffset === 'fab'
        ? '64px'
        : '12px';

  const getContainerBorder = () => {
    switch (state) {
      case 'disabled':
        return '1px solid rgba(68, 86, 105, 0.4)';
      case 'thinking':
        return '1px solid rgba(0, 229, 255, 0.35)';
      case 'talking':
        return '1px solid rgba(128, 240, 255, 0.65)';
      case 'standby':
      default:
        return '1px solid rgba(10, 72, 88, 0.6)';
    }
  };

  const getContainerShadow = () => {
    switch (state) {
      case 'disabled':
        return '0 4px 10px rgba(0, 0, 0, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.05)';
      case 'thinking':
        return '0 0 18px rgba(0, 229, 255, 0.3)';
      case 'talking':
        return '0 0 24px rgba(0, 229, 255, 0.55)';
      case 'standby':
      default:
        return '0 0 12px rgba(0, 229, 255, 0.15)';
    }
  };

  return (
    <Box
      sx={(theme) => ({
        position: 'fixed',
        bottom: bottomStyle,
        right: 12,
        width: 40,
        height: 40,
        borderRadius: '50%',
        boxShadow: getContainerShadow(),
        backgroundColor: '#020810',
        border: getContainerBorder(),
        zIndex: theme.zIndex.drawer + 2,
        transition: theme.transitions.create(['bottom', 'border-color', 'box-shadow'], {
          duration: theme.transitions.duration.enteringScreen,
          easing: theme.transitions.easing.easeOut,
        }),
      })}
    >
      <Tooltip title={title} placement="left" arrow>
        <Svg
          ref={svgRef}
          data-state={state}
          viewBox="0 0 200 200"
          width="100%"
          height="100%"
          onClick={toggle}
          role="button"
          aria-label={title}
        >
          <defs>
            <clipPath id="cc"><circle cx="100" cy="100" r="97"/></clipPath>
            <filter id="gs" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur in="SourceGraphic" stdDeviation="2"/></filter>
            <filter id="gm" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur in="SourceGraphic" stdDeviation="4.5"/></filter>
            <filter id="gl" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur in="SourceGraphic" stdDeviation="10"/></filter>
            <radialGradient id="bg"><stop offset="0%" stopColor="#0a1e2a"/><stop offset="55%" stopColor="#050e16"/><stop offset="100%" stopColor="#020810"/></radialGradient>
            <radialGradient id="cg"><stop offset="0%" stopColor="var(--cy)" stopOpacity=".5"/><stop offset="100%" stopColor="var(--cy)" stopOpacity="0"/></radialGradient>
            <pattern id="gr" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="rgba(0,229,255,.025)" strokeWidth=".25"/></pattern>
          </defs>
          <g clipPath="url(#cc)">
            {/* BG */}
            <circle cx="100" cy="100" r="97" fill="url(#bg)"/>
            <circle cx="100" cy="100" r="97" fill="url(#gr)"/>
            <circle className="bg-gl" cx="100" cy="100" r="40" fill="url(#cg)" opacity=".25"/>

            {/* Traces */}
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
              {/* N sector */}
              <path className="tr" d="M100,89 V14" strokeWidth="1.3"/>
              <path className="tr" d="M96,60 V22" strokeWidth=".55"/>

              {/* NNW sector */}
              <path className="tr" d="M94,89 V66 L78,50 H52" strokeWidth="3.5"/>
              <path className="tr" d="M78,50 V26" strokeWidth=".6"/>
              <path className="tr" d="M52,50 L38,36" strokeWidth=".45"/>
              <path className="tr" d="M36,30 H18" strokeWidth=".35"/>

              {/* NNE sector */}
              <path className="tr" d="M106,89 V72 L122,56 V34" strokeWidth="3.5"/>
              <path className="tr" d="M122,56 H138" strokeWidth=".5"/>
              <path className="tr" d="M140,42 L152,30" strokeWidth=".4"/>

              {/* ENE sector */}
              <path className="tr" d="M111,94 H134 V68 L148,54" strokeWidth="3.0"/>
              <path className="tr" d="M150,50 V34 H168" strokeWidth=".45"/>

              {/* E sector */}
              <path className="tr" d="M111,100 H188" strokeWidth="1.3"/>
              <path className="tr" d="M146,104 H178" strokeWidth=".55"/>
              <path className="tr" d="M170,96 V80 H184" strokeWidth=".4"/>

              {/* ESE sector */}
              <path className="tr" d="M111,106 H132 V130 H158 V152" strokeWidth="3.0"/>
              <path className="tr" d="M162,132 V146 H176" strokeWidth=".42"/>
              <path className="tr" d="M174,140 H190" strokeWidth=".35"/>

              {/* SSE sector */}
              <path className="tr" d="M106,111 V132 L122,148 V172" strokeWidth="3.0"/>
              <path className="tr" d="M126,154 H148" strokeWidth=".45"/>

              {/* S sector */}
              <path className="tr" d="M100,111 V186" strokeWidth="1.3"/>
              <path className="tr" d="M104,144 V180" strokeWidth=".55"/>

              {/* SSW sector */}
              <path className="tr" d="M94,111 V138 H68 V162" strokeWidth="3.5"/>
              <path className="tr" d="M80,138 V150" strokeWidth=".5"/>
              <path className="tr" d="M64,142 V168" strokeWidth=".45"/>
              <path className="tr" d="M42,164 L30,176" strokeWidth=".38"/>

              {/* WSW sector */}
              <path className="tr" d="M89,106 H66 L50,122 H28" strokeWidth="3.0"/>
              <path className="tr" d="M66,112 H44" strokeWidth=".5"/>
              <path className="tr" d="M28,122 V148" strokeWidth=".4"/>

              {/* W sector */}
              <path className="tr" d="M89,100 H12" strokeWidth="1.3"/>
              <path className="tr" d="M58,96 H18" strokeWidth=".5"/>
              <path className="tr" d="M54,92 H24" strokeWidth=".4"/>

              {/* WNW sector */}
              <path className="tr" d="M89,94 H66 V72 H42 L28,58" strokeWidth="3.5"/>
              <path className="tr" d="M42,72 V54" strokeWidth=".5"/>

              {/* Energy Flow Overlays */}
              <path className="ef" d="M100,89 V14" stroke="var(--cy-b)" strokeWidth="1.6" strokeDasharray="4 16" filter="url(#gs)"/>
              <path className="ef" d="M100,111 V186" stroke="var(--cy-b)" strokeWidth="1.6" strokeDasharray="4 16" filter="url(#gs)" style={{ animationDelay: '.15s' }}/>
              <path className="ef" d="M89,100 H12" stroke="var(--cy-b)" strokeWidth="1.6" strokeDasharray="4 16" filter="url(#gs)" style={{ animationDelay: '.35s' }}/>
              <path className="ef" d="M111,100 H188" stroke="var(--cy-b)" strokeWidth="1.6" strokeDasharray="4 16" filter="url(#gs)" style={{ animationDelay: '.5s' }}/>
              <path className="ef" d="M94,89 V66 L78,50 H52" stroke="var(--cy-b)" strokeWidth="3.5" strokeDasharray="10 30" filter="url(#gs)" style={{ animationDelay: '.1s' }}/>
              <path className="ef" d="M106,89 V72 L122,56 V34" stroke="var(--cy-b)" strokeWidth="3.5" strokeDasharray="10 30" filter="url(#gs)" style={{ animationDelay: '.25s' }}/>
              <path className="ef" d="M89,106 H66 L50,122 H28" stroke="var(--cy-b)" strokeWidth="3.0" strokeDasharray="10 30" filter="url(#gs)" style={{ animationDelay: '.4s' }}/>
              <path className="ef" d="M111,94 H134 V68 L148,54" stroke="var(--cy-b)" strokeWidth="3.0" strokeDasharray="10 30" filter="url(#gs)" style={{ animationDelay: '.55s' }}/>
            </g>

            {/* Neural Arcs */}
            <g fill="none" strokeWidth=".5">
              <path className="na" d="M36,30 Q18,44 22,60"/>
              <path className="na" d="M168,34 Q180,46 174,58"/>
              <path className="na" d="M172,166 Q182,158 176,146"/>
              <path className="na" d="M30,176 Q18,162 28,148"/>
              <path className="na" d="M52,50 Q48,64 42,72" strokeWidth=".35"/>
              <path className="na" d="M138,56 Q146,48 150,50" strokeWidth=".35"/>
            </g>

            {/* Orbital Rings */}
            <circle className="rng" cx="100" cy="100" r="65" fill="none" strokeWidth=".35" strokeDasharray="3 7"/>
            <circle className="rng" cx="100" cy="100" r="84" fill="none" strokeWidth=".25" strokeDasharray="2 9"/>

            {/* Nodes */}
            <g filter="url(#gs)">
              {/* Vias */}
              <circle className="nd" cx="94"  cy="66"  r="2.8"/>
              {/* Core Node 1: Upper-Left Junction */}
              <circle className="nd-core-halo" cx="78" cy="50" r="11.0" fill="none" strokeWidth="1.8" />
              <circle className="nd" cx="78"  cy="50"  r="5.5"/>
              <circle className="nd" cx="106" cy="72"  r="2.5"/>
              {/* Core Node 2: Upper-Right Junction */}
              <circle className="nd-core-halo" cx="122" cy="56" r="11.0" fill="none" strokeWidth="1.8" />
              <circle className="nd" cx="122" cy="56"  r="5.5"/>
              <circle className="nd" cx="66"  cy="94"  r="2.8"/>
              <circle className="nd" cx="66"  cy="72"  r="2.5"/>
              <circle className="nd" cx="42"  cy="72"  r="2.4"/>
              <circle className="nd" cx="134" cy="94"  r="2.6"/>
              <circle className="nd" cx="134" cy="68"  r="2.5"/>
              <circle className="nd" cx="66"  cy="106" r="2.5"/>
              <circle className="nd" cx="50"  cy="122" r="2.6"/>
              <circle className="nd" cx="132" cy="106" r="2.4"/>
              {/* Core Node 3: Lower-Right Junction */}
              <circle className="nd-core-halo" cx="132" cy="130" r="11.0" fill="none" strokeWidth="1.8" />
              <circle className="nd" cx="132" cy="130" r="5.5"/>
              <circle className="nd" cx="158" cy="130" r="2.4"/>
              <circle className="nd" cx="94"  cy="138" r="2.6"/>
              <circle className="nd" cx="68"  cy="138" r="2.5"/>
              <circle className="nd" cx="106" cy="132" r="2.4"/>
              <circle className="nd" cx="122" cy="148" r="2.5"/>

              {/* Endpoints */}
              <circle className="nd" cx="100" cy="14"  r="2"/>
              <circle className="nd" cx="100" cy="186" r="2"/>
              <circle className="nd" cx="12"  cy="100" r="2"/>
              <circle className="nd" cx="188" cy="100" r="2"/>
              <circle className="nd" cx="52"  cy="50"  r="2"/>
              <circle className="nd" cx="122" cy="34"  r="1.8"/>
              <circle className="nd" cx="28"  cy="58"  r="2"/>
              <circle className="nd" cx="148" cy="54"  r="2"/>
              <circle className="nd" cx="68"  cy="162" r="1.8"/>
              <circle className="nd" cx="122" cy="172" r="1.8"/>
              <circle className="nd" cx="28"  cy="122" r="1.8"/>
              <circle className="nd" cx="158" cy="152" r="1.8"/>
              <circle className="nd" cx="150" cy="34"  r="1.8"/>

              {/* Small details */}
              <circle className="nd" cx="96"  cy="22"  r="1.3"/>
              <circle className="nd" cx="78"  cy="26"  r="1.4"/>
              <circle className="nd" cx="38"  cy="36"  r="1.3"/>
              <circle className="nd" cx="18"  cy="30"  r="1.1"/>
              <circle className="nd" cx="138" cy="56"  r="1.3"/>
              <circle className="nd" cx="152" cy="30"  r="1.2"/>
              <circle className="nd" cx="168" cy="34"  r="1.2"/>
              <circle className="nd" cx="42"  cy="54"  r="1.3"/>
              <circle className="nd" cx="18"  cy="96"  r="1.2"/>
              <circle className="nd" cx="24"  cy="92"  r="1.1"/>
              <circle className="nd" cx="178" cy="104" r="1.2"/>
              <circle className="nd" cx="184" cy="80"  r="1.1"/>
              <circle className="nd" cx="162" cy="132" r="1.2"/>
              <circle className="nd" cx="176" cy="146" r="1.2"/>
              <circle className="nd" cx="190" cy="140" r="1"/>
              <circle className="nd" cx="148" cy="154" r="1.2"/>
              <circle className="nd" cx="104" cy="180" r="1.3"/>
              <circle className="nd" cx="80"  cy="150" r="1.2"/>
              <circle className="nd" cx="64"  cy="168" r="1.2"/>
              <circle className="nd" cx="30"  cy="176" r="1.1"/>
              <circle className="nd" cx="44"  cy="112" r="1.1"/>
              <circle className="nd" cx="28"  cy="148" r="1.2"/>
              <circle className="nd" cx="140" cy="42"  r="1.1"/>
            </g>

            {/* SMD Pads */}
            <rect className="pad" x="186" y="99" width="4" height="2.5" rx=".4"/>
            <rect className="pad" x="8"   y="99" width="4" height="2.5" rx=".4"/>
            <rect className="pad" x="99"  y="10" width="2.5" height="4" rx=".4"/>
            <rect className="pad" x="99"  y="184" width="2.5" height="4" rx=".4"/>
            <rect className="pad" x="26"  y="57" width="3" height="2" rx=".3" transform="rotate(-35 27.5 58)"/>
            <rect className="pad" x="147" y="53" width="3" height="2" rx=".3" transform="rotate(35 148.5 54)"/>

            {/* Core Chip (Small 22x22) */}
            <g className="core-group">
              <rect className="core-glow" x="82" y="82" width="36" height="36" rx="5" fill="var(--cy)" opacity=".25" filter="url(#gl)"/>
              <rect className="core-body" x="89" y="89" width="22" height="22" rx="1.5" strokeWidth="1.2"/>
              
              {/* Pins */}
              <line className="pin-s" x1="94"  y1="89" x2="94"  y2="86" strokeWidth=".8"/>
              <line className="pin-s" x1="100" y1="89" x2="100" y2="86" strokeWidth=".8"/>
              <line className="pin-s" x1="106" y1="89" x2="106" y2="86" strokeWidth=".8"/>
              <line className="pin-s" x1="94"  y1="111" x2="94"  y2="114" strokeWidth=".8"/>
              <line className="pin-s" x1="100" y1="111" x2="100" y2="114" strokeWidth=".8"/>
              <line className="pin-s" x1="106" y1="111" x2="106" y2="114" strokeWidth=".8"/>
              <line className="pin-s" x1="89"  y1="94" x2="86"  y2="94" strokeWidth=".8"/>
              <line className="pin-s" x1="89"  y1="100" x2="86"  y2="100" strokeWidth=".8"/>
              <line className="pin-s" x1="89"  y1="106" x2="86"  y2="106" strokeWidth=".8"/>
              <line className="pin-s" x1="111" y1="94" x2="114"  y2="94" strokeWidth=".8"/>
              <line className="pin-s" x1="111" y1="100" x2="114"  y2="100" strokeWidth=".8"/>
              <line className="pin-s" x1="111" y1="106" x2="114"  y2="106" strokeWidth=".8"/>

              {/* Inner pattern */}
              <rect className="core-die" x="92" y="92" width="16" height="16" rx=".5" strokeWidth=".4"/>
              <line className="die-l" x1="95"  y1="93" x2="95"  y2="107" strokeWidth=".2"/>
              <line className="die-l" x1="100" y1="93" x2="100" y2="107" strokeWidth=".2"/>
              <line className="die-l" x1="105" y1="93" x2="105" y2="107" strokeWidth=".2"/>
              <line className="die-l" x1="93"  y1="97" x2="107" y2="97" strokeWidth=".2"/>
              <line className="die-l" x1="93"  y1="103" x2="107" y2="103" strokeWidth=".2"/>
              <circle className="align-dot" cx="93.5" cy="93.5" r=".7"/>

              {/* Core center light */}
              <circle className="core-dot" cx="100" cy="100" r="3.5" filter="url(#gm)"/>
              <circle className="core-dot-i" cx="100" cy="100" r="1.5"/>
            </g>

            {/* Voice waves (talking only) */}
            <circle className="vw" cx="100" cy="100" r="16" fill="none" stroke="var(--cy-b)" strokeWidth="1.5" opacity="0"/>
            <circle className="vw" cx="100" cy="100" r="16" fill="none" stroke="var(--cy)" strokeWidth="1" opacity="0" style={{ animationDelay: '.22s' }}/>
            <circle className="vw" cx="100" cy="100" r="16" fill="none" stroke="var(--cy-d)" strokeWidth=".7" opacity="0" style={{ animationDelay: '.44s' }}/>

            {/* Dynamic Particles */}
            <g ref={ptclRef} className="ptcl"></g>
          </g>
          <circle cx="100" cy="100" r="97" fill="none" stroke="var(--cy-d)" strokeWidth=".5" opacity=".25"/>
        </Svg>
      </Tooltip>
    </Box>
  );
}
