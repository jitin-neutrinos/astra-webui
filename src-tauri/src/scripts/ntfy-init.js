(() => {
  if (window.__ASTRA_PUSH__) return; window.__ASTRA_PUSH__ = true;
  const WS = '__NTFY_WS_URL__';            // wss://ntfy.jitinnair.com/<topic>/ws?auth=<b64>
  const seen = new Set();                  // dedupe by message id (reconnect replays)
  let attempt = 0, timer = null;
  const emit = (ev, p) => { try { window.__TAURI__?.event?.emit(ev, p); } catch {} };

  window.__astraNavigate__ = (u) => { try { if (location.href !== u) location.href = u; } catch {} };

  function connect() {
    let ws;
    try { ws = new WebSocket(WS); } catch { return retry(); }
    ws.onopen = () => { attempt = 0; emit('ntfy-status', { connected: true }); };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.event !== 'message' || !m.id || seen.has(m.id)) return;  // skip open/keepalive/poll_request + dupes
      seen.add(m.id); if (seen.size > 200) seen.delete(seen.values().next().value);
      emit('ntfy-message', { id: m.id, title: m.title || 'Astra', body: m.message || '', click: m.click || null });
    };
    ws.onclose = retry; ws.onerror = () => ws.close();
  }
  function retry() {
    const delay = Math.min(60000, 1000 * 2 ** attempt++) + Math.random() * 1000; // exp backoff 1s→60s + jitter
    clearTimeout(timer); timer = setTimeout(connect, delay);
  }
  connect();
})();
