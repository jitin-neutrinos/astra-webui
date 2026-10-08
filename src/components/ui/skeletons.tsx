import { Skeleton } from "./skeleton";

// Composed loading skeletons for Astra's three async surfaces, shaped after
// 21st.dev "Chat Thread Skeleton" (v-skeleton-9: bubbles + shimmer) and
// "List Skeleton with Icons" (skeleton-03: icon rows + bars). Each mirrors the
// REAL row anatomy so the swap is zero-layout-shift (Skeleton Swap pattern).

// ---- chat feed: alternating user / Astra bubbles (new in-bubble head layout)
function BubbleSkeleton({ ai }: { ai?: boolean }) {
  return (
    <div className={ai ? "chat-turn" : "chat-bubble-user rounded-2xl px-4 py-3 text-sm"}>
      <div className="flex items-center gap-2 mb-2.5">
        {ai ? (
          <Skeleton className="h-[22px] w-[22px] rounded-md" />
        ) : (
          <Skeleton className="h-[18px] w-[18px] rounded-[6px]" />
        )}
        <Skeleton className="ml-auto h-2.5 w-10" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className={ai ? "h-3 w-[92%]" : "h-3 w-[70%]"} />
        {ai && <Skeleton className="h-3 w-[85%]" />}
      </div>
    </div>
  );
}

function ChatFeedSkeleton() {
  return (
    // pb-44 matches .chat-feed's live clearance (owner 10-08): the composer
    // floats over the transcript now, so skeleton rows must stop ABOVE it —
    // never render under/behind the input+button-bar shell.
    <div className="chat-feed mx-auto flex w-full max-w-[52rem] flex-col gap-6 px-4 pt-8 pb-44" aria-busy="true" aria-label="Loading conversation">
      <BubbleSkeleton />
      <BubbleSkeleton ai />
      <BubbleSkeleton />
      <BubbleSkeleton ai />
    </div>
  );
}

// ---- sidebar chats panel: icon row + title bar + timestamp bar
// Owner: this list's animation is GREY ONLY — no cyan tint.
function SessionRowSkeleton() {
  return (
    <div className="flex w-full items-start gap-3 rounded-lg border border-transparent p-2.5" aria-hidden="true">
      <Skeleton grey className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Skeleton grey className="h-3.5 w-12 rounded" />
          <Skeleton grey className="h-3.5 flex-1" />
        </div>
        <Skeleton grey className="h-2.5 w-28" />
      </div>
    </div>
  );
}

function SessionsSkeleton({ n = 7 }: { n?: number }) {
  return (
    <div className="space-y-1" aria-busy="true" aria-label="Loading chats">
      {Array.from({ length: n }, (_, i) => <SessionRowSkeleton key={i} />)}
    </div>
  );
}

// ---- files page: 48px thumb + name/date bars
function FileRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] p-2" aria-hidden="true">
      <Skeleton className="h-12 w-12 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-2.5 w-24" />
      </div>
    </div>
  );
}

function FilesSkeleton({ n = 4 }: { n?: number }) {
  return (
    <div className="space-y-1" aria-busy="true" aria-label="Loading files">
      {Array.from({ length: n }, (_, i) => <FileRowSkeleton key={i} />)}
    </div>
  );
}

// New-chat variant (owner workflow 2026-10-01): ONE minimal skeleton row shaped
// like the live greeting turn (in-bubble logo head + text bars). Shown ONLY on
// the new-chat path while the auto-greet's session is minting and no content
// has streamed yet; replaced the moment the first segment lands.
function NewChatGreetSkeleton() {
  return (
    <div className="chat-feed mx-auto flex w-full max-w-[52rem] flex-col gap-6 px-4 pt-8 pb-44" aria-busy="true" aria-label="Starting new chat">
      <div className="chat-turn">
        <div className="flex items-center gap-2 mb-2.5">
          <Skeleton className="h-[22px] w-[22px] rounded-md" />
          <Skeleton className="ml-auto h-2.5 w-10" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-[92%]" />
          <Skeleton className="h-3 w-[70%]" />
        </div>
      </div>
    </div>
  );
}

export { ChatFeedSkeleton, NewChatGreetSkeleton, SessionsSkeleton, FilesSkeleton };
