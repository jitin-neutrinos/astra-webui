import fs from 'fs';

let landing = fs.readFileSync('src/components/chat-landing.tsx', 'utf8');
landing = landing.replace(
  /import \{ ComposerControls, ComposerMenu \} from "\.\/composer-controls";/,
  `import { ComposerControls, ComposerMenu, type Attachment, filesToAttachments } from "./composer-controls";`
);
landing = landing.replace(
  /onOpenChange=\{\(o\) =>/,
  `onOpenChange={(o: boolean) =>`
);
fs.writeFileSync('src/components/chat-landing.tsx', landing);


let cmd = fs.readFileSync('src/components/ui/command.tsx', 'utf8');
// just remove the whole CommandDialog export
cmd = cmd.replace(/const CommandDialog =[^]+?<\/Dialog>\n  \)\n\}\n/, '');
cmd = cmd.replace(/export interface CommandDialogProps[^]+?\}\n/, '');
// remove it from the exports at the bottom
cmd = cmd.replace(/,\n  CommandDialog,\n/, ',\n');
fs.writeFileSync('src/components/ui/command.tsx', cmd);

let controls = fs.readFileSync('src/components/composer-controls.tsx', 'utf8');
controls = controls.replace(/import \{ Popover, PopoverTrigger, PopoverContent \} from "@\/components\/ui\/popover";/, 
`import { Popover, PopoverTrigger } from "@/components/ui/popover";`);
controls = controls.replace(/import \{ Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem \} from "@\/components\/ui\/command";/,
`import { Command, CommandInput, CommandList, CommandGroup, CommandItem } from "@/components/ui/command";`);
controls = controls.replace(/onInteractOutside=\{\(e\) => \{/, `onInteractOutside={() => {`);
fs.writeFileSync('src/components/composer-controls.tsx', controls);

let menu = fs.readFileSync('src/lib/composer-menu.ts', 'utf8');
menu = menu.replace('import type { CatalogPayload } from "../components/composer-controls";', '');
fs.writeFileSync('src/lib/composer-menu.ts', menu);

