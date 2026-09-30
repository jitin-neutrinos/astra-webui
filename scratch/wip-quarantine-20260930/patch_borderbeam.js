import fs from 'fs';
let content = fs.readFileSync('src/components/chat-landing.tsx', 'utf8');

content = content.replace(
  /className=\{cn\("chat-composer mx-auto w-full max-w-\[52rem\] relative flex flex-col overflow-hidden bg-\[var\(--surface-base\)\] rounded-\[16px\] border shadow-sm transition-shadow focus-within:shadow-md focus-within:border-\[var\(--color-cyanx\)\] focus-within:ring-1 focus-within:ring-\[var\(--color-cyanx\)\]", dragOver && "drag-over"\)\}/,
  'className={cn("group chat-composer mx-auto w-full max-w-[52rem] relative flex flex-col overflow-hidden bg-[var(--surface-base)] rounded-[16px] border shadow-sm transition-shadow focus-within:shadow-md focus-within:border-[var(--color-cyanx)] focus-within:ring-1 focus-within:ring-[var(--color-cyanx)]", dragOver && "drag-over")}'
);

content = content.replace(
  /className=\{cn\("absolute inset-0 pointer-events-none", \(isStreaming \|\| input.length > 0\) \? "hidden" : "block", reducedMotion \? "hidden" : ""\)\}/,
  'className={cn("absolute inset-0 pointer-events-none hidden group-focus-within:block", (isStreaming || input.length > 0 || reducedMotion) ? "!hidden" : "")}'
);

fs.writeFileSync('src/components/chat-landing.tsx', content);
