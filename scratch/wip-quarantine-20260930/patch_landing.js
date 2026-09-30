import fs from 'fs';
let content = fs.readFileSync('src/components/chat-landing.tsx', 'utf8');

// 1. imports
content = content.replace(
  /import \{ ComposerControls, \w+, \w+ \} from "\.\/composer-controls";/,
  `import { ComposerControls, ComposerMenu } from "./composer-controls";\nimport { filterSlashCommands } from "../lib/composer-menu";\nimport { BorderBeam } from "./ui/border-beam";\nimport { CommandGroup, CommandItem, CommandList } from "./ui/command";`
);
// Make sure it actually matches whatever was imported:
content = content.replace(
  /import \{ ComposerControls[^\}]*\} from "\.\/composer-controls";/,
  `import { ComposerControls, ComposerMenu } from "./composer-controls";\nimport { filterSlashCommands } from "../lib/composer-menu";\nimport { BorderBeam } from "./ui/border-beam";\nimport { CommandGroup, CommandItem, CommandList } from "./ui/command";`
);

// We need to find the `chat-composer` div and replace it.
// The easiest way is to rewrite the return statement part from `        <div className={cn("chat-composer mx-auto w-full max-w-[52rem]", dragOver && "drag-over")}>` to the end of the file.

const composerStart = `        <div className={cn("chat-composer mx-auto w-full max-w-[52rem]", dragOver && "drag-over")}>`;
const parts = content.split(composerStart);
if (parts.length === 2) {
  const newComposer = `
        <div className={cn("chat-composer mx-auto w-full max-w-[52rem] relative flex flex-col overflow-hidden", dragOver && "drag-over")}>
          <BorderBeam size={150} duration={8} colorFrom="var(--color-cyanx)" colorTo="var(--color-violetx)" className={cn("absolute inset-0 pointer-events-none", (isStreaming || input.length > 0) ? "hidden" : "block", "max-sm:hidden")} />
          {dragOver && <div className="chat-drop-overlay" aria-hidden="true">Drop to attach</div>}
          {!atBottom && (
            <button
              type="button"
              className="chat-jump"
              aria-label={isStreaming ? "Jump to latest — Astra is still replying" : "Jump to latest message"}
              onClick={() => {
                const el = listRef.current;
                if (el) { el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" }); lastScrollTopRef.current = el.scrollHeight; }
                setAtBottom(true);
              }}
            >
              <ChevronDown className="h-4 w-4" strokeWidth={1.5} /> Jump to latest
              {isStreaming && <span className="chat-jump-live" aria-hidden="true" />}
            </button>
          )}

          <ComposerMenu
            open={slashOpen && slashMatches.length > 0}
            onOpenChange={(o) => { if (!o) setSlashOpen(false); }}
            anchorRef={taRef}
            contentClassName="w-[300px]"
          >
            <CommandList className="max-h-[300px] overflow-y-auto p-1.5 space-y-0.5">
              <CommandGroup heading="TUI commands">
                {slashMatches.map((c) => (
                  <CommandItem key={c} value={c} onSelect={() => pickSlash(c)} className="h-8 rounded-[8px] cursor-pointer">
                    {c}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </ComposerMenu>

          <AttachmentTray items={attachments} onRemove={removeAttachment} onRetry={retryAttachment} countLabel={sendHint || (attachments.length > 0 ? \`\${attachments.length} file\${attachments.length === 1 ? "" : "s"}\` : undefined)} />

          <textarea
            ref={taRef}
            id="composer-input"
            rows={1}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKey}
            onPaste={onPaste}
            placeholder={isStreaming ? "Astra is replying..." : "Message Astra..."}
            aria-label="Message Astra"
            aria-describedby="composer-kb-hint"
            className="chat-composer-input px-3 pt-3 pb-2 text-[16px] md:text-[14.5px]"
          />
          
          <div className="flex items-center justify-between border-t border-slate-700/20 px-2 py-2 mt-1 bg-black/10">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <ComposerControls
                setAttachments={setAttachments}
                sessionInfo={sessionInfo}
                catalog={catalog}
                onOpen={refreshCatalog}
                sessionPending={!!storedSessionId && !sessionInfo}
                onToggleYolo={onToggleYolo}
                onPickModel={onPickModel}
                onPickEffort={onPickEffort}
              />
            </div>
            
            <div className="flex items-center gap-3 shrink-0 ml-2">
              <span id="composer-kb-hint" className="text-[11px] text-muted-foreground max-md:hidden">
                Enter to send
              </span>
              {isStreaming ? (
                <button type="button" onClick={stop} aria-label="Stop generation" title="Stop generation" className="chat-send chat-send-stop">
                  <Square className="h-3.5 w-3.5" fill="currentColor" />
                </button>
              ) : (
                <button type="button" onClick={() => void send()} disabled={!canSend} aria-busy={isSending} aria-label={sendHint || "Send message"} title={sendHint || undefined} className="chat-send relative">
                  {isSending ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <ArrowUp className="h-4 w-4" strokeWidth={1.8} />}
                </button>
              )}
            </div>
          </div>
          
          {sendError && (
            <div className="flex items-center justify-between bg-red-500/10 text-red-400 px-3 py-2 text-[12px] font-medium border-t border-red-500/20">
              <span>{sendError}</span>
              <button onClick={() => void send()} className="text-red-300 hover:text-red-100 underline decoration-red-500/30">Retry</button>
            </div>
          )}
        </div>
      </div>
      {viewer && (
        <Suspense fallback={null}>
          <MediaViewer items={viewer.items} index={viewer.index} onClose={() => setViewer(null)} />
        </Suspense>
      )}
      <ToastHost muted={!!viewer} />
    </main>
  );
}
`;
  content = parts[0] + composerStart + newComposer;
}

// 1. Remove slashActive state
content = content.replace(/const \[slashActive, setSlashActive\] = useState\(0\);\n?/, '');

// 2. Remove arrow-key branches in onKey
const onKeyOld = `    if (slashOpen && slashMatches.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashActive((i) => (i + 1) % slashMatches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlashActive((i) => (i - 1 + slashMatches.length) % slashMatches.length); return; }
      if (e.key === "Escape") { setSlashOpen(false); return; }
      if (e.key === "Enter" && !e.shiftKey && !coarse) { e.preventDefault(); pickSlash(slashMatches[slashActive] || slashMatches[0]); return; }
      return;
    }`;
content = content.replace(onKeyOld, '');

// 3. Update slash command filtering to use the pure function
content = content.replace(
  /const matches = TUI_COMMANDS\.filter\(\(c\) => c\.startsWith\(lower\)\);/,
  `const matches = filterSlashCommands(newInput);`
);
content = content.replace(
  /if \(matches\.length\) \{\n\s*setSlashMatches\(matches\);\n\s*setSlashActive\(0\);\n\s*setSlashOpen\(true\);\n\s*\}/,
  `if (matches.length) {\n        setSlashMatches(matches);\n        setSlashOpen(true);\n      }`
);

// 4. Update pickSlash signature
content = content.replace(/setSlashActive\(0\);/g, '');

// add Loader2 to lucide imports
content = content.replace(/import \{([^}]+)\} from "lucide-react";/, (m, p1) => {
  if (p1.includes('Loader2')) return m;
  return `import {${p1}, Loader2} from "lucide-react";`;
});

// We might need to add isSending state
if (!content.includes('const [isSending')) {
  // If it doesn't exist, we'll just fake it or add it
  // Wait, there's `const [isSending, setIsSending] = useState(false);`?
  // Let's check.
}

fs.writeFileSync('src/components/chat-landing.tsx', content);
