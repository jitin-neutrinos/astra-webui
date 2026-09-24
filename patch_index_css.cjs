const fs = require('fs');
let content = fs.readFileSync('src/index.css', 'utf8');

// P8
content = content.replace(
  `/* ---- chat replica (ported from astra.css / ChatPageV2, retinted) ---- */`,
  `/* ---- chat replica (ported from astra.css / ChatPageV2, retinted) ---- */\n/* shape system: outer containers 16px, floating panels 14px, inner cards 12px, interactive pills 9999px */`
);

// P7
content = content.replace(
  `.chat-welcome-title { font: 500 34px/1.2 var(--font-display); color: var(--color-brandtext); margin: 0 0 6px; }`,
  `.chat-welcome-title { font: 500 34px/1.2 var(--font-display); color: var(--color-brandtext); margin: 0 0 6px; letter-spacing: -0.02em; }`
);
content = content.replace(
  `.chat-welcome-sub { font: 400 15px/1.5 var(--font-sans); color: var(--color-muted); margin: 0 0 28px; }`,
  `.chat-welcome-sub { font: 400 15px/1.5 var(--font-sans); color: var(--color-muted); margin: 0 0 28px; letter-spacing: 0.01em; }`
);

// P1
content = content.replace(
  `.chat-suggest { `,
  `.chat-suggest { transform-origin: center; ` // just in case
).replace(
  `transition: border-color 150ms cubic-bezier(0.23,1,0.32,1), background-color 150ms cubic-bezier(0.23,1,0.32,1);`,
  `transition: border-color 150ms cubic-bezier(0.23,1,0.32,1), background-color 150ms cubic-bezier(0.23,1,0.32,1), transform 120ms cubic-bezier(0.23,1,0.32,1);`
);

content = content.replace(
  `transition: border-color 150ms ease, color 150ms ease, background-color 150ms ease;`,
  `transition: border-color 150ms ease, color 150ms ease, background-color 150ms ease, transform 120ms cubic-bezier(0.23,1,0.32,1);`
);

content = content.replace(
  `.chat-approval-btn { min-height: 40px; padding: 0 16px; border-radius: 8px; border: 1px solid rgba(248,250,252,.14); background: transparent; color: var(--color-brandtext); font: 500 12px/1 var(--font-sans); cursor: pointer; }`,
  `.chat-approval-btn { min-height: 40px; padding: 0 16px; border-radius: 8px; border: 1px solid rgba(248,250,252,.14); background: transparent; color: var(--color-brandtext); font: 500 12px/1 var(--font-sans); cursor: pointer; transition: transform 120ms cubic-bezier(0.23,1,0.32,1); }`
);

content = content.replace(
  `.chat-step { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 6px 4px; border: none; background: transparent; color: var(--color-muted); font: 400 12.5px/1.4 var(--font-mono); cursor: pointer; min-height: 28px; border-radius: 6px; }`,
  `.chat-step { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 6px 4px; border: none; background: transparent; color: var(--color-muted); font: 400 12.5px/1.4 var(--font-mono); cursor: pointer; min-height: 28px; border-radius: 6px; transition: transform 120ms cubic-bezier(0.23,1,0.32,1); }`
);

content = content.replace(
  `.chat-head-link { display:inline-flex; align-items:center; justify-content:center; padding:2px; border-radius:4px; color:var(--color-muted); cursor:pointer; background:transparent; border:none; transition:color 0.15s, background 0.15s; }`,
  `.chat-head-link { display:inline-flex; align-items:center; justify-content:center; padding:2px; border-radius:4px; color:var(--color-muted); cursor:pointer; background:transparent; border:none; transition:color 0.15s, background 0.15s, transform 120ms cubic-bezier(0.23,1,0.32,1); }`
);

content = content.replace(
  `.chat-popout-chip { display: none !important; }`,
  `.chat-popout-chip { display: none !important; }\n.chat-popout-chip { transition: transform 120ms cubic-bezier(0.23,1,0.32,1); }`
);

// Wait, I should just add the active state at the bottom of the chat replica section.
// Also add the new animations.
const activeRule = `\n.chat-send:active, .chat-chip:active, .chat-suggest:active, .chat-approval-btn:active, .chat-step:active, .chat-head-link:active, .chat-popout-chip:active { transform: scale(0.96); }\n`;

// Let's just append the active rule where `.chat-send:active` is, or just at the end.
content = content.replace(
  `.chat-send:active { transform: scale(0.94); }`,
  `.chat-send:active { transform: scale(0.94); }\n.chat-chip:active, .chat-suggest:active, .chat-approval-btn:active, .chat-step:active, .chat-head-link:active, .chat-popout-chip:active { transform: scale(0.96); }`
);

// P4
content = content.replace(
  `.chat-composer { background: var(--color-depth); border: 1px solid rgba(248,250,252,.10); border-radius: 16px; padding: 10px 12px 8px; transition: border-color 150ms cubic-bezier(0.23,1,0.32,1); }`,
  `.chat-composer { background: var(--color-depth); border: 1px solid rgba(248,250,252,.10); border-radius: 16px; padding: 10px 12px 8px; transition: border-color 150ms cubic-bezier(0.23,1,0.32,1), box-shadow 150ms cubic-bezier(0.23,1,0.32,1); }`
);
content = content.replace(
  `.chat-composer:focus-within { border-color: rgba(34,211,238,.4); }`,
  `.chat-composer:focus-within { border-color: rgba(34,211,238,.4); box-shadow: 0 0 0 3px rgba(34,211,238,.08); }`
);

// P2
content = content.replace(
  `.chat-menu { position: absolute; top: calc(100% + 8px); left: 0; min-width: 260px; max-height: 340px; overflow-y: auto; background: rgba(11, 17, 32, 0.75); backdrop-filter: blur(16px) saturate(1.4); -webkit-backdrop-filter: blur(16px) saturate(1.4); border: 1.5px solid rgba(248,250,252,.2); border-radius: 14px; padding: 8px; box-shadow: 0 20px 50px rgba(0,0,0,.6), 0 0 0 1px rgba(34,211,238,.15), inset 0 1px 0 rgba(255,255,255,.05); animation: chat-enter 150ms cubic-bezier(0.23,1,0.32,1) both; z-index: 100; }`,
  `.chat-menu { position: absolute; top: calc(100% + 8px); left: 0; min-width: 260px; max-height: 340px; overflow-y: auto; background: rgba(11, 17, 32, 0.75); backdrop-filter: blur(16px) saturate(1.4); -webkit-backdrop-filter: blur(16px) saturate(1.4); border: 1.5px solid rgba(248,250,252,.2); border-radius: 14px; padding: 8px; box-shadow: 0 20px 50px rgba(0,0,0,.6), 0 0 0 1px rgba(34,211,238,.15), inset 0 1px 0 rgba(255,255,255,.05); animation: chat-pop 160ms cubic-bezier(0.23,1,0.32,1) both; transform-origin: bottom left; z-index: 100; }`
);

content = content.replace(
  `.chat-popout { position: absolute; bottom: calc(100% + 10px); left: 0; right: 0; z-index: 55; background: var(--color-midnight); border: 1px solid rgba(34,211,238,.25); border-radius: 14px; padding: 10px 12px 12px; box-shadow: 0 18px 50px rgba(0,0,0,.6); animation: chat-enter 150ms cubic-bezier(0.23,1,0.32,1) both; }`,
  `.chat-popout { position: absolute; bottom: calc(100% + 10px); left: 0; right: 0; z-index: 55; background: var(--color-midnight); border: 1px solid rgba(34,211,238,.25); border-radius: 14px; padding: 10px 12px 12px; box-shadow: 0 18px 50px rgba(0,0,0,.6); animation: chat-pop 160ms cubic-bezier(0.23,1,0.32,1) both; transform-origin: bottom center; }`
);

const newKeyframes = `
@keyframes chat-pop { from { opacity: 0; transform: scale(0.96) translateY(4px); } to { opacity: 1; transform: none; } }
`;
content = content.replace(`@keyframes chat-enter {`, newKeyframes + `\n@keyframes chat-enter {`);

// P3 & P6
content = content.replace(
  `.chat-turn { display: flex; flex-direction: column; gap: 8px; border: 1px solid rgba(248,250,252,.08); border-radius: 14px; padding: 12px 14px; background: rgba(255,255,255,.015); }`,
  `.chat-turn { display: flex; flex-direction: column; gap: 8px; border: 1px solid rgba(248,250,252,.08); border-radius: 14px; padding: 12px 14px; background: rgba(255,255,255,.015); animation: chat-turn-in 200ms cubic-bezier(0.23,1,0.32,1) both; }
@keyframes chat-turn-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }`
);

content = content.replace(
  `.chat-step-body { padding: 2px 4px 8px 25px; }`,
  `.chat-step-body { padding: 2px 4px 8px 25px; }
.chat-step-body, .chat-think-text { animation: chat-body-in 180ms cubic-bezier(0.23,1,0.32,1) both; }
@keyframes chat-body-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }`
);

// Reduced motion block for P2, P3, P6
content = content.replace(
  `.chat-suggest { animation: none; }`,
  `.chat-suggest, .chat-menu, .chat-popout, .chat-step-body, .chat-think-text, .chat-turn { animation: none; }`
);


fs.writeFileSync('src/index.css', content);
