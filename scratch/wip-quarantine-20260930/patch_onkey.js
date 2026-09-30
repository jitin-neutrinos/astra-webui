import fs from 'fs';

let content = fs.readFileSync('src/components/chat-landing.tsx', 'utf8');

const oldOnKey = `  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composing: Enter commits the composition — never send (R8).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key === "Enter") { e.preventDefault(); void send(); return; }
    // Touch keyboards: Enter = newline; sending is the button's job.
    if (e.key === "Enter" && !e.shiftKey && !coarse) { e.preventDefault(); void send(); }
  };`;

const newOnKey = `  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composing: Enter commits the composition — never send (R8).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key === "Enter") {
      e.preventDefault();
      if (canSend) void send();
      return;
    }
    // Touch keyboards: Enter = newline; sending is the button's job.
    if (e.key === "Enter" && !e.shiftKey && !coarse) {
      e.preventDefault();
      if (canSend) void send();
    }
  };`;

if (content.includes(oldOnKey)) {
  content = content.replace(oldOnKey, newOnKey);
  fs.writeFileSync('src/components/chat-landing.tsx', content);
} else {
  console.log("Could not find onKey block");
}
