function maskCommand(cmd) {
  if (!cmd) return cmd;
  if (/password|token|secret|api[_-]?key/i.test(cmd)) {
    if (cmd.includes("=")) {
      return cmd.replace(/=([^\s]+)/g, "=•••");
    }
    const parts = cmd.split(/\s+/);
    if (parts.length > 2) {
      return parts.slice(0, 2).join(" ") + " •••";
    }
  }
  return cmd;
}

console.log(maskCommand("export MY_SECRET=xyz123"));
console.log(maskCommand("do_thing --token abcdef"));
