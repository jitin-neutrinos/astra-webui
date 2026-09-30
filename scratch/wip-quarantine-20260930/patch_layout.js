import fs from 'fs';

let content = fs.readFileSync('src/components/chat-landing.tsx', 'utf8');

// replace chat-composer div completely
const startMarker = `        <div className={cn("chat-composer mx-auto w-full max-w-[52rem]", dragOver && "drag-over")}>`;
const endMarker = `      </div>\n      {viewer && (`

const p1 = content.indexOf(startMarker);
const p2 = content.indexOf(endMarker);

if (p1 !== -1 && p2 !== -1) {
  const replacement = `
        <div className={cn("chat-composer mx-auto w-full max-w-[52rem] relative flex flex-col overflow-hidden bg-[var(--surface-base)] rounded-[16px] border shadow-sm transition-shadow focus-within:shadow-md focus-within:border-[var(--color-cyanx)] focus-within:ring-1 focus-within:ring-[var(--color-cyanx)]", dragOver && "drag-over")}>
          <BorderBeam size={150} duration={8} colorFrom="var(--color-cyanx)" colorTo="var(--color-violetx)" className={cn("absolute inset-0 pointer-events-none", (isStreaming || input.length > 0) ? "hidden" : "block", reducedMotion ? "hidden" : "")} />
          {dragOver && (
            <div className="chat-drop-overlay" aria-hidden="true">Drop to attach</div>
          )}
          {!atBottom && (
            <button
              type="button"
              className="chat-jump z-20"
              aria-label={isStreaming ? "Jump to latest — Astra is still replying" : "Jump to latest message"}
              onClick={() => {
                const el = listRef.current;
                if (el) {
                  el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
                  lastScrollTopRef.current = el.scrollHeight;
                }
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
            contentClassName="w-[300px] z-50"
          >
            <CommandList className="max-h-[300px] overflow-y-auto p-1.5 space-y-0.5">
              <CommandGroup heading="TUI commands">
                {slashMatches.map((c) => (
                  <CommandItem
                    key={c}
                    value={c}
                    onSelect={() => pickSlash(c)}
                    className="h-8 rounded-[8px] cursor-pointer"
                  >
                    {c}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </ComposerMenu>

          <AttachmentTray items={attachments} onRemove={removeAttachment} onRetry={retryAttachment} countLabel={attachments.length > 0 ? \`\${attachments.length} file\${attachments.length === 1 ? "" : "s"}\` : undefined} />

          <label htmlFor="composer-input" className="sr-only">Message Astra</label>
          <textarea
            id="composer-input"
            ref={taRef}
            rows={1}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKey}
            onPaste={onPaste}
            placeholder={isStreaming ? "Reply, /bg to queue, /steer to correct…" : empty ? "Message Astra… (/ for commands)" : "Reply…"}
            aria-describedby="composer-kb-hint"
            className="w-full resize-none bg-transparent px-4 pt-4 pb-2 text-[16px] md:text-[14.5px] font-sans text-[var(--color-brandtext)] placeholder:text-muted-foreground outline-none border-none min-h-[56px] relative z-10"
            style={{ 
              // The original chat-composer-input had styling, we recreate it here
              // Let the autosize logic handle height
            }}
          />

          {failedUp && (
            <div className="flex items-center justify-between bg-red-500/10 text-red-400 px-4 py-2 text-[12px] font-medium border-t border-red-500/20 relative z-10">
              <span>Upload failed. Please retry or remove failed attachments.</span>
              <button type="button" onClick={() => attachments.filter(a => a.status === 'error').forEach(a => retryAttachment(a.id))} className="text-red-300 hover:text-red-100 underline decoration-red-500/30">Retry Failed</button>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-white/[0.08] px-2 py-2 bg-[var(--surface-base)] relative z-10">
            <ComposerControls
              setAttachments={setAttachments}
              sessionInfo={sessionInfo}
              catalog={catalog}
              onOpen={refreshCatalog}
              sessionPending={!!storedSessionId && !sessionInfo}
              onToggleYolo={onToggleYolo}
              onPickModel={onPickModel}
              onPickEffort={onPickEffort}
              disabled={isStreaming}
            />
            
            <div className="flex items-center gap-3 shrink-0 ml-2">
              <span id="composer-kb-hint" className="text-[11px] text-muted-foreground hidden md:inline-block select-none">
                {isStreaming ? "Queue message · Shift+Enter newline" : "Enter to send · Shift+Enter newline"}
              </span>
              {isStreaming ? (
                <button
                  type="button" onClick={stop}
                  aria-label="Stop generation"
                  title="Stop generation"
                  className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[var(--color-surface)] text-[var(--color-brandtext)] hover:bg-[var(--color-surface)] hover:text-red-400 transition-colors"
                >
                  <Square className="h-4 w-4" fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button" onClick={() => void send()}
                  disabled={!canSend}
                  aria-label={sendHint || "Send message"}
                  title={sendHint || undefined}
                  className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[var(--color-cyanx)] text-black hover:bg-[#34e0f5] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ArrowUp className="h-4.5 w-4.5" strokeWidth={2} />
                </button>
              )}
            </div>
          </div>
        </div>
`;

  content = content.slice(0, p1) + replacement + content.slice(p2);
  fs.writeFileSync('src/components/chat-landing.tsx', content);
} else {
  console.log("Could not find markers");
}

