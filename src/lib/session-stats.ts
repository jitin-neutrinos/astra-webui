import type { Segment } from "./chat-segments";
import { describeTool } from "./tool-identity";
import { classifySegment } from "./plan-phases";

export interface SessionStats {
  filesTouched?: string[];
  filesRead?: number;
  commands?: number;
  toolCalls?: number;
  failures?: number;
  recovered?: number;
  testsPassed?: number;
  testsFailed?: number;
  durationMs?: number;
}

export function computeStats(segs: Segment[], firstTs?: number, lastTs?: number): SessionStats {
  const stats: SessionStats = {};

  const toolSegs = segs.filter(s => s.kind === "tool");
  if (toolSegs.length === 0) return stats;

  stats.toolCalls = toolSegs.length;

  const filesTouched = new Set<string>();
  const filesRead = new Set<string>();
  let commands = 0;
  let failures = 0;
  let hasResultText = false;
  
  // For recovery
  const failedCommands = new Set<string>();
  let recovered = 0;

  for (const seg of toolSegs) {
    const info = describeTool(seg.label, seg.argsText, seg.command);
    let args: any = null;
    try {
      if (seg.argsText) args = JSON.parse(seg.argsText);
    } catch {}

    if ((seg.label === "write_file" || seg.label === "patch") && args?.path) {
      filesTouched.add(args.path);
    }

    if (seg.label === "read_file" && args?.path) {
      filesRead.add(args.path);
    }

    if (info.kind === "terminal") {
      commands++;
      
      if (seg.resultText) {
        if (stats.testsPassed === undefined && stats.testsFailed === undefined) {
          const match1 = seg.resultText.match(/Tests:\s+(\d+) failed[^\n]*?(\d+) passed/);
          if (match1) {
            stats.testsFailed = parseInt(match1[1], 10);
            stats.testsPassed = parseInt(match1[2], 10);
          } else {
            const match2 = seg.resultText.match(/(\d+) passed(?:,\s*(\d+) failed)?/);
            if (match2) {
              stats.testsPassed = parseInt(match2[1], 10);
              stats.testsFailed = match2[2] ? parseInt(match2[2], 10) : 0;
            } else {
              const match3 = seg.resultText.match(/(\d+) failing/);
              if (match3) {
                stats.testsFailed = parseInt(match3[1], 10);
              } else {
                const match4 = seg.resultText.match(/\bALL PASS\b/);
                if (match4) {
                  stats.testsFailed = 0;
                }
              }
            }
          }
        }
      }
    }

    if (seg.resultText !== undefined || seg.exitCode !== undefined) {
      hasResultText = true;
    }

    const hit = classifySegment(seg);
    const cmdStr = seg.command || info.meta || "";
    
    if (hit?.phase === "debugging") {
      failures++;
      if (cmdStr) failedCommands.add(cmdStr);
    } else if (seg.exitCode === 0 && cmdStr && failedCommands.has(cmdStr)) {
      recovered++;
      failedCommands.delete(cmdStr); // Only recover once per failure? Or can a command be recovered multiple times? Let's assume once per failure, but since we just keep incrementing recovered for every exitCode 0 of a failed command, we should delete or we overcount. Let's delete.
    }
  }

  if (filesTouched.size > 0) stats.filesTouched = Array.from(filesTouched);
  if (filesRead.size > 0) stats.filesRead = filesRead.size;
  if (commands > 0) stats.commands = commands;
  
  if (hasResultText) {
    stats.failures = failures;
    if (failures !== undefined) stats.recovered = recovered; // wait, if failures > 0 is not required for undefined?
    // "recovered: undefined when failures undefined".
  }

  if (firstTs != null && lastTs != null) {
    stats.durationMs = lastTs - firstTs;
  }

  return stats;
}
