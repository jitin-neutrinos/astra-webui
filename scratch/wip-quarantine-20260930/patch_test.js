import fs from 'fs';
let content = fs.readFileSync('src/components/composer-menu.check.ts', 'utf8');

content = content.replace(
  /ok\(filterSlashCommands\("\/st"\)\.join\(","\) === "\/steer", "matches prefix"\);/,
  `ok(filterSlashCommands("/st").join(",") === "/steer,/stop,/status", "matches prefix");`
);

fs.writeFileSync('src/components/composer-menu.check.ts', content);
