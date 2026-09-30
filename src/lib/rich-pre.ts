// Shared wiring for markdown-rendered regions: per-<pre> copy buttons with the
// copy→check swap animation. Extracted from chat-timeline RichText (2026-09-30)
// so tool-card rich fields get the exact same behavior without a circular
// import. Idempotent — tags wired <pre>s with data-cb.
export function wireCodeCopyButtons(root: HTMLElement, copy: (t: string) => Promise<boolean>) {
  // One-time style injection for the DOM-built code copy buttons (they are
  // created imperatively, outside React — same swap animation as the
  // React-side .chat-copy-swap buttons).
  if (!document.getElementById("chat-code-copy-style")) {
    const st = document.createElement("style");
    st.id = "chat-code-copy-style";
    st.textContent = `
.chat-code-copy { position:relative; overflow:hidden; }
.chat-code-copy .cc-swap { position:absolute; inset:0; }
.chat-code-copy .cc-swap svg { position:absolute; inset:0; width:100%; height:100%; transition:opacity 160ms ease, transform 160ms ease; }
.chat-code-copy .cc-swap svg.cc-check { opacity:0; transform:scale(.5) rotate(-45deg); }
.chat-code-copy.is-check .cc-swap svg.cc-copy { opacity:0; transform:scale(.5) rotate(45deg); }
.chat-code-copy.is-check .cc-swap svg.cc-check { opacity:1; transform:scale(1) rotate(0deg); color:#34d399; }
[data-theme="light"] .chat-code-copy.is-check .cc-swap svg.cc-check { color:#047857; }`;
    document.head.appendChild(st);
  }
  const pres = root.querySelectorAll("pre:not([data-cb])");
  pres.forEach((pre) => {
    pre.setAttribute("data-cb", "1");
    const btn = document.createElement("button");
    btn.className = "chat-code-copy";
    btn.innerHTML = `<span class="cc-swap" aria-hidden="true"><svg class="cc-copy" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><svg class="cc-check" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>`;
    btn.setAttribute("aria-label", "Copy code");
    btn.title = "Copy";
    btn.onclick = () => {
      void copy(pre.textContent || "").then((ok) => {
        if (!ok) return;
        btn.classList.add("is-check");
        btn.title = "Copied";
        setTimeout(() => { btn.classList.remove("is-check"); btn.title = "Copy"; }, 2000);
      });
    };
  });
}
