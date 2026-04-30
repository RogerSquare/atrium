// xterm color palettes per app theme.
//
// Hand-curated rather than read from CSS vars because xterm needs ~20
// color values (background, foreground, cursor, cursorAccent,
// selectionBackground, plus the 16 ANSI slots) — putting that many
// shell-specific tokens in index.css would bloat the theme blocks for
// a single consumer. Base colors here mirror the corresponding theme
// block in index.css (`--bg-app`, `--text-app`); ANSI slots lean on
// each theme's accent palette for consistent vibe but stay close to
// standard terminal-color expectations (red is red, green is green).
//
// xterm.js v6 ITheme keys: background, foreground, cursor, cursorAccent,
// selectionBackground, black, red, green, yellow, blue, magenta, cyan,
// white, brightBlack, brightRed, brightGreen, brightYellow, brightBlue,
// brightMagenta, brightCyan, brightWhite.

const PALETTES = {
  // Apple Standard Dark — matches `:root` in index.css L138-160.
  dark: {
    background: '#1c1c1e',
    foreground: '#f5f5f7',
    cursor: '#f5f5f7',
    cursorAccent: '#1c1c1e',
    selectionBackground: 'rgba(255, 255, 255, 0.20)',
    black: '#3a3a3c',
    red: '#ff453a',
    green: '#30d158',
    yellow: '#ffd60a',
    blue: '#0a84ff',
    magenta: '#bf5af2',
    cyan: '#64d2ff',
    white: '#aeaeb2',
    brightBlack: '#636366',
    brightRed: '#ff6961',
    brightGreen: '#5eea7a',
    brightYellow: '#ffe45e',
    brightBlue: '#409cff',
    brightMagenta: '#d27dff',
    brightCyan: '#88e0ff',
    brightWhite: '#f5f5f7',
  },

  // Apple Standard Light — matches `[data-theme='light']` L165-187.
  // Yellow shifted darker (#a87900) so it stays readable on cream bg.
  light: {
    background: '#f2f2f7',
    foreground: '#1c1c1e',
    cursor: '#1c1c1e',
    cursorAccent: '#f2f2f7',
    selectionBackground: 'rgba(0, 0, 0, 0.18)',
    black: '#1c1c1e',
    red: '#ff3b30',
    green: '#34c759',
    yellow: '#a87900',
    blue: '#007aff',
    magenta: '#af52de',
    cyan: '#5ac8fa',
    white: '#8e8e93',
    brightBlack: '#3a3a3c',
    brightRed: '#d1242f',
    brightGreen: '#2da44e',
    brightYellow: '#bf6900',
    brightBlue: '#0a84ff',
    brightMagenta: '#8250df',
    brightCyan: '#0d8a8a',
    brightWhite: '#1c1c1e',
  },

  // True Black OLED — matches `[data-theme='oled']` L192-214.
  oled: {
    background: '#000000',
    foreground: '#e5e5ea',
    cursor: '#e5e5ea',
    cursorAccent: '#000000',
    selectionBackground: 'rgba(255, 255, 255, 0.18)',
    black: '#1c1c1e',
    red: '#ff453a',
    green: '#30d158',
    yellow: '#ffd60a',
    blue: '#0a84ff',
    magenta: '#bf5af2',
    cyan: '#64d2ff',
    white: '#aeaeb2',
    brightBlack: '#48484a',
    brightRed: '#ff6961',
    brightGreen: '#5eea7a',
    brightYellow: '#ffe45e',
    brightBlue: '#409cff',
    brightMagenta: '#d27dff',
    brightCyan: '#88e0ff',
    brightWhite: '#e5e5ea',
  },

  // Warm Cream Paper — matches `[data-theme='paper']` L219-241.
  // Reds + magentas tuned warmer to fit the cream canvas; yellow
  // darkened to a deep amber for legibility on the off-white bg.
  paper: {
    background: '#faf5ef',
    foreground: '#3d3229',
    cursor: '#3d3229',
    cursorAccent: '#faf5ef',
    selectionBackground: 'rgba(120, 90, 50, 0.20)',
    black: '#3d3229',
    red: '#d1242f',
    green: '#2da44e',
    yellow: '#bf8700',
    blue: '#0070e0',
    magenta: '#8250df',
    cyan: '#0d8a8a',
    white: '#9a8b7a',
    brightBlack: '#65564a',
    brightRed: '#e8750a',
    brightGreen: '#3fb05f',
    brightYellow: '#d49a00',
    brightBlue: '#0a84ff',
    brightMagenta: '#a070e8',
    brightCyan: '#1ca6a6',
    brightWhite: '#3d3229',
  },
}

// "auto" is exposed in the AvatarPopover theme picker but
// AuthContext doesn't (yet) resolve it to a concrete theme — when
// it's saved, the html attribute is `data-theme="auto"` and no CSS
// rule matches, so the app falls through to `:root` (dark today).
// Fallback returns the OLED palette to match the app default flipped
// in ui-oled-default-001.
export function getXtermTheme(themeName) {
  return PALETTES[themeName] || PALETTES.oled
}
