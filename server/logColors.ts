// Colorize server logs by subsystem to mirror the app's palette. Opportunity logs use
// their card colour (courier = blue, arbitrage = green, package = orange), gate-kills use
// the null-sec purple, the companion uses magenta; everything else stays the default.
//
// Truecolor ANSI, applied ONLY when stdout is a TTY (local dev). Piped output — e.g. the
// Hugging Face Space log capture — stays plain, so no escape codes leak into it. Honour
// NO_COLOR (disable) and FORCE_COLOR=1 (force on even when piped). Import this FIRST, for
// its side effect, so console is patched before anything logs.
const enabled =
  process.env.NO_COLOR === undefined &&
  (Boolean(process.stdout.isTTY) || process.env.FORCE_COLOR === '1');

const RESET = '\x1b[0m';
function fg(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
}

// First matching rule wins. Each rule: [colour, tags that trigger it].
const RULES: Array<[string, string[]]> = [
  [fg('#d670d6'), ['[Companion]', '[TTS]']], // companion — magenta
  [fg('#8D3163'), ['[gate-kills]']], // gate kills — null-sec purple
  [fg('#4dd0e1'), ['[Contracts Crawl]']], // courier — blue (ContractCard primary)
  [fg('#56d364'), ['[Market]']], // arbitrage — green
  [fg('#ffb74d'), ['[Packages]']], // package — orange (theme secondary)
];

function colorFor(msg: string): string | null {
  for (const [color, tags] of RULES) {
    if (tags.some((t) => msg.includes(t))) return color;
  }
  return null;
}

if (enabled) {
  type LogFn = (...args: unknown[]) => void;
  const c = console as unknown as Record<string, LogFn>;
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const orig = c[method].bind(console) as LogFn;
    c[method] = (...args: unknown[]) => {
      const first = args[0];
      if (typeof first === 'string') {
        const color = colorFor(first);
        if (color) {
          orig(color + first + RESET, ...args.slice(1));
          return;
        }
      }
      orig(...args);
    };
  }
}
