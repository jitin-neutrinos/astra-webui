import fs from 'fs';
let content = fs.readFileSync('src/components/chat-landing.tsx', 'utf8');

content = content.replace(/const TUI_COMMANDS = \[\n(?:  ".*",\n)*\];\n/, '');

fs.writeFileSync('src/components/chat-landing.tsx', content);
