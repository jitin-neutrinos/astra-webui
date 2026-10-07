// Shared wiring for markdown-rendered regions: per-<pre> copy buttons with the
// copy→check swap animation. Extracted from chat-timeline RichText (2026-09-30)
// so tool-card rich fields get the exact same behavior without a circular
// import. Idempotent — tags wired <pre>s with data-cb.
//
// 2026-10-08: buttons reuse the SAME classes as the React AnimatedCopyButton
// (.chat-code-copy + .chat-copy-swap + .chat-copy-ic + .is-check) instead of a
// privately injected stylesheet — one copy system, one set of colors/timing.
// Check color comes from the theme tokens in index.css (was hardcoded #34d399).
export function wireCodeCopyButtons(root: HTMLElement, copy: (t: string) => Promise<boolean>) {
  const pres = root.querySelectorAll("pre:not([data-cb])");
  pres.forEach((pre) => {
    pre.setAttribute("data-cb", "1");
    const btn = document.createElement("button");
    btn.className = "chat-code-copy";
    btn.innerHTML = `<span class="chat-copy-swap" aria-hidden="true"><svg class="chat-copy-ic" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><svg class="chat-copy-ic" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>`;
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
