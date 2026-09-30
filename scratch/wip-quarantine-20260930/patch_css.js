import fs from 'fs';

let content = fs.readFileSync('src/index.css', 'utf8');

const lines = content.split('\n');

const isDead = (line) => {
  return line.includes('.chat-menu') ||
         line.includes('.chat-slash-menu') ||
         line.includes('.chat-menu-label') ||
         line.includes('.chat-menu-item') ||
         line.includes('.chat-menu-item-active') ||
         line.includes('.chat-yolo-switch') ||
         line.includes('.chat-yolo-knob') ||
         line.includes('.chat-composer-hint');
};

const newLines = lines.filter(l => !isDead(l));

fs.writeFileSync('src/index.css', newLines.join('\n'));

