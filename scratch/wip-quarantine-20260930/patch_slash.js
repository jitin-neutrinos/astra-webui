import fs from 'fs';
let content = fs.readFileSync('src/components/chat-landing.tsx', 'utf8');

content = content.replace(
  /const slashMatches = TUI_COMMANDS\.filter\(\(c\) => c\.startsWith\(input\)\);/,
  `const slashMatches = filterSlashCommands(input);`
);

fs.writeFileSync('src/components/chat-landing.tsx', content);

let cmd = fs.readFileSync('src/components/ui/command.tsx', 'utf8');
cmd = cmd.replace('import { type DialogProps } from "@radix-ui/react-dialog"', '');
fs.writeFileSync('src/components/ui/command.tsx', cmd);

