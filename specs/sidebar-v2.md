# Spec: Astra webUI — collapsible sidebar + chats-in-sidebar + selection state

Repo: ~/Work/projects/astra-webui (vite react-ts + tailwind v4, zero new deps).
Live: test.jitinnair.com via systemd-user astra-webui.service (server/server.mjs, port 3011).
Deploy is OUT OF SCOPE — you never run npm run build for deploy, systemd, or tunnel work. Source changes only. Operator builds+deploys.

## Current state (verified facts)
- Shell: `src/App.tsx` → `Shell` component renders `<div className="app-shell flex w-full overflow-hidden ...">` with `Sidebar` (aside, w-60, fixed width, NOT collapsible) + view switch: `view === 'chat' ? <ChatLanding/> : <ChatsPanel/>`.
- Chats list: `src/components/chats-panel.tsx` currently REPLACES the whole chat area (main region) when user clicks "Chats". It has its own back button (ArrowLeft), search (debounced 300ms), pagination (10/page, offset-based), error/retry states.
- Sidebar header currently: logo + "Astral Command Center" on two lines (title text-sm, subtitle font-mono 8px "astra webui").
- Sidebar nav groups: Work (Astra/New chat/Chats/Files), Configure (Model/Config/Env/Skills/Plugins/MCP/Profile), Operations (Cron Jobs/Logs/System Health/Analytics/Webhooks & Pairing), Logout pinned bottom.
- Chat selection state today: Shell holds `view` ('chat'|'chats'), `selectedSessionId`, `resetSignal`. ChatLanding takes selectedSessionId + resetSignal. There is NO selected/active styling on sidebar items.
- Brand tokens in `src/index.css` @theme: cyanx #22d3ee, void/midnight/depth backgrounds, DM Sans/Playfair/JetBrains Mono. Reduced-motion blocks already exist — respect them.

## Requirements

R1 — Collapsible sidebar
- Add a collapse/expand toggle button in the sidebar header row (lucide `PanelLeftClose` / `PanelLeftOpen`).
- Collapsed state: sidebar shrinks to an icon rail (~w-14), nav labels + group labels hidden, header shows logo only, logout shows icon only. Group labels become hidden; items show `title` attribute tooltips.
- Expanded: today's layout, but header text becomes "Astra" (title line) with "Command Center" below it (replaces "Astral Command Center" + "astra webui").
- State lives in Shell: `useState`, initialized from localStorage key `astra-sidebar-collapsed` ("1"/"0"), persisted on toggle. No animation library — a single CSS transition on width (150ms, disabled under prefers-reduced-motion).
- Toggle must remain a 44px-ish hit target, aria-label="Collapse sidebar"/"Expand sidebar", `aria-expanded` on the button.

R2 — Selected tab state
- When view is 'chat' (new chat OR resumed session), the sidebar "Astra" item renders selected: bg-cyanx/10 + text-cyanx (match existing "Chats" live-badge styling).
- While the sidebar is showing the chats list (R3), the "Chats" entry that opened it is conceptually selected — but since the nav is replaced by the list, the selected state requirement applies to the Astra item only.
- aria-current="page" on the selected item.

R3 — Chats list lives IN the sidebar
- Clicking "Chats" no longer swaps the main chat area. Instead the sidebar's nav region is replaced by the ChatsPanel contents: back button (returns to the global nav groups), search, session list, pagination — all inside the sidebar column.
- The main area keeps showing whatever it showed (ChatLanding). Selecting a session sets selectedSessionId and switches main view to 'chat' and the sidebar returns to the global nav with Astra selected.
- Rework chats-panel.tsx into a sidebar-density component (same data layer: /api/hx/sessions + /api/hx/sessions/search, 10/page, debounce, error+retry). Keep the component; adjust layout for ~15rem width: tighter rows, smaller paddings. Back button behavior: returns to nav groups.
- The shell no longer needs the view==='chats' main-area swap; view state becomes: 'chat' always in main; sidebar has its own mode: 'nav' | 'chats'.

R4 — Header copy
- Title: "Astra". Subtitle: "Command Center". No other copy changes.

## Constraints (hard)
- No new npm dependencies. lucide-react + existing tailwind only.
- Do not touch: server/, ChatLanding message logic, WS layer (src/lib/hermes-ws.ts), chat-timeline logic, composer controls, login screen.
- Keep the existing reduced-motion pattern; any new transition gets a reduced-motion opt-out.
- TypeScript strict passes; `npm run build` must succeed (builder may run build to verify compile — that is allowed; DEPLOY is not).
- File map expected: src/App.tsx (Shell/Sidebar rework), src/components/chats-panel.tsx (sidebar-density rework), src/index.css (any new classes). Prefer smallest diff.

## Done condition
The implementer never needs a clarifying question. Every R1-R4 item has a one-line self-test note in the final report: what to click, what should happen.

## Top risks
- Sidebar width transition vs overflow-hidden shell: ensure no horizontal scrollbar appears mid-transition.
- ChatsPanel pagination math (`maxOffset`) must survive the density rework unchanged.
- localStorage read must be guarded (SSR-safe not needed, but JSON-safe parse not required — plain string compare).
