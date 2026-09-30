import fs from 'fs';

let controls = fs.readFileSync('src/components/composer-controls.tsx', 'utf8');
controls = controls.replace(/ease: \[0\.16, 1, 0\.3, 1\]/g, 'ease: [0.16, 1, 0.3, 1] as any');
controls = controls.replace(/ease: \[0\.4, 0, 1, 1\]/g, 'ease: [0.4, 0, 1, 1] as any');
fs.writeFileSync('src/components/composer-controls.tsx', controls);

let landing = fs.readFileSync('src/components/chat-landing.tsx', 'utf8');
landing = landing.replace(/ease: \[0\.16, 1, 0\.3, 1\]/g, 'ease: [0.16, 1, 0.3, 1] as any');
landing = landing.replace(/ease: \[0\.4, 0, 1, 1\]/g, 'ease: [0.4, 0, 1, 1] as any');
fs.writeFileSync('src/components/chat-landing.tsx', landing);

let menu = fs.readFileSync('src/lib/composer-menu.ts', 'utf8');
menu = menu.replace('import { CatalogPayload }', 'import type { CatalogPayload }');
fs.writeFileSync('src/lib/composer-menu.ts', menu);

let cmd = fs.readFileSync('src/components/ui/command.tsx', 'utf8');
// command.tsx imports Dialog from @/registry/new-york/ui/dialog. We don't have it.
// We can just comment out CommandDialog and the import.
cmd = cmd.replace('import { Dialog, DialogContent } from "@/registry/new-york/ui/dialog"', '// import Dialog');
cmd = cmd.replace(/const CommandDialog = \(\{\n  children,\n  \.\.\.props\n\}: CommandDialogProps\) => \{[\s\S]*?\}\n/, '');
cmd = cmd.replace(/export interface CommandDialogProps extends DialogProps \{[\s\S]*?\}/, '');
fs.writeFileSync('src/components/ui/command.tsx', cmd);

