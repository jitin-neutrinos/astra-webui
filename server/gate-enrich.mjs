export const SEVERITY_ORDER = {
  low: 0,
  moderate: 1,
  high: 2,
  critical: 3
};

const SEVERITY_KEYWORDS = {
  critical: ["rm ", "mkfs", "dd ", "format"],
  high: ["dnf ", "apt ", "pacman ", "systemctl ", "chmod ", "chown ", "kernel", "driver", "pip ", "npm ", "kill ", "docker ", "apt-get "],
  moderate: ["write", "edit", "mkdir ", "mv ", "cp ", "git ", "touch ", "sed ", "echo "],
  low: ["cat ", "ls ", "grep ", "curl ", "wget ", "journalctl "]
};

export function enrichGate(inner, method) {
  let command = inner.command || "";
  let description = inner.description || "";

  let severity = "moderate";
  let risk = "Unrecognized command — review before approving.";
  let impact = "Changes system state";

  let whatItDoes = "";

  if (command) {
    const cmdStr = command.trim() + " ";
    let found = false;

    // critical
    if (!found) {
      for (const kw of SEVERITY_KEYWORDS.critical) {
        if (cmdStr.includes(kw)) {
          severity = "critical";
          if (cmdStr.includes("rm ")) {
            impact = "Files deleted permanently";
            risk = "Irreversible deletion — cannot be undone.";
            let target = command.split(" ").slice(1).join(" ");
            if (target.includes("-r") || target.includes("-f")) {
               target = command.replace(/rm\s+(-\w+\s+)+/, "");
            } else {
               target = target.replace(/^-+\w+\s+/, "");
            }
            whatItDoes = `Deletes ${target} permanently`;
          } else {
            impact = "Disk operations";
            risk = "Irreversible modification — cannot be undone.";
          }
          found = true;
          break;
        }
      }
    }

    // high
    if (!found) {
      for (const kw of SEVERITY_KEYWORDS.high) {
        if (cmdStr.includes(kw)) {
          severity = "high";
          impact = "Package or system state changed";
          risk = "Changes system state; reversible with effort.";
          found = true;
          break;
        }
      }
    }

    // moderate
    if (!found) {
      for (const kw of SEVERITY_KEYWORDS.moderate) {
        if (cmdStr.includes(kw)) {
          severity = "moderate";
          impact = "Files created or modified";
          risk = "Changes system state; reversible with effort.";
          found = true;
          break;
        }
      }
    }

    // low
    if (!found) {
      for (const kw of SEVERITY_KEYWORDS.low) {
        if (cmdStr.includes(kw)) {
          severity = "low";
          impact = "Read-only lookup — nothing changed";
          risk = "No changes to your machine.";
          found = true;
          break;
        }
      }
    }
    
    if (!whatItDoes) {
        if (description) {
            whatItDoes = description;
        } else {
            whatItDoes = `Executes \`${command.substring(0, 30)}${command.length > 30 ? "..." : ""}\``;
        }
    }

  } else if (method === "clarify" || inner.question || inner.questions) {
     severity = "low";
     impact = "Clarification needed";
     risk = "No changes to your machine.";
     whatItDoes = inner.question || (inner.questions && inner.questions.length > 0 && inner.questions[0].question) || description || "Astra has a question";
  }

  if (!whatItDoes || typeof whatItDoes !== "string") {
    whatItDoes = description || "Astra wants to run a command";
  }

  // Cap whatItDoes length roughly for UI 
  if (whatItDoes.length > 120) {
      whatItDoes = whatItDoes.substring(0, 117) + "...";
  }
  
  // ensure it is one plain-English sentence
  whatItDoes = whatItDoes.charAt(0).toUpperCase() + whatItDoes.slice(1);

  return { impact, severity, risk, whatItDoes };
}
