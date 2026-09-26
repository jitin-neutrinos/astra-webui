#!/usr/bin/env python3
"""One-time contextual rename of existing webui chats.

Skips titles that are already contextual (llm-sourced) and user-named rows
(user provenance wins over automation). Targets the weak rows: derived /
untitled / user-titled-but-content-free ("You there?").

Rename method: state.db rows carry the transcript, so each candidate gets a
3-8 word title generated from its first two user messages via the tool-router's
existing gemini-flash rewriter endpoint (same model the router uses; free).

Dry-run by default; pass --apply to write.  user-titled rows are only renamed
with --apply --include-user.
"""
import json
import os
import sqlite3
import subprocess
import sys
import urllib.request

DB = "/home/notjitin/.hermes/state.db"
BUDGET_CHARS = 1200


def candidates(conn, include_user: bool):
    sql = """
      select s.id, s.title, s.title_source,
             (select group_concat(substr(m.content, 1, 400), '\n---\n')
                from messages m
               where m.session_id = s.id and m.role = 'user'
                 and m.content is not null and length(m.content) > 3
               order by m.id limit 2) as seed
        from sessions s
       where s.source = 'webui'
         and s.hidden = 0
         and (s.title is null or s.title = '' or s.title_source in ('derived', 'user'))
         and (:iu = 1 or s.title_source != 'user')
    """
    rows = conn.execute(sql, {"iu": 1 if include_user else 0}).fetchall()
    out = []
    for sid, title, source, seed in rows:
        if not seed or len(seed.strip()) < 12:
            continue  # nothing to summarize from
        # "You there?" style rows have almost no signal; keep budget sane
        out.append({"id": sid, "title": title or "", "source": source,
                    "seed": seed[:BUDGET_CHARS]})
    return out


def load_rewriter():
    """Resolve the rewriter's Gemini key: env first, then the systemd user
    environment (where the tool-router intercept gets it)."""
    import re
    key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not key:
        try:
            out = subprocess.run(
                ["systemctl", "--user", "show-environment"],
                capture_output=True, text=True, timeout=10).stdout
            m = re.search(r"^GOOGLE_API_KEY=(.+)$", out, re.M)
            if m:
                key = m.group(1).strip()
        except Exception:
            pass
    return (key, "gemini-flash-lite-latest")


def title_with_gemini(key: str, model: str, seed: str) -> str | None:
    prompt = (
        "Give a 3-8 word title for this chat, based only on its substance. "
        "No quotes, no period, Title Case. If it is only small talk or a "
        "greeting, reply exactly: SKIP\n\n" + seed
    )
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 24},
    }).encode()
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
        data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.load(r)
        text = (data["candidates"][0]["content"]["parts"][0]["text"] or "").strip()
        return None if (not text or "SKIP" in text.upper()) else text.splitlines()[0][:64]
    except Exception as e:
        print(f"  ! title call failed: {e}", file=sys.stderr)
        return None


def main() -> int:
    apply = "--apply" in sys.argv
    include_user = "--include-user" in sys.argv
    conn = sqlite3.connect(DB)
    rows = candidates(conn, include_user)
    print(f"{len(rows)} chats to rename (apply={apply}, include_user={include_user})")
    if not rows:
        return 0
    key, model = load_rewriter()
    if apply and not key:
        print("no GOOGLE_API_KEY for rewriter; cannot generate titles", file=sys.stderr)
        return 1
    changed = 0
    for row in rows:
        new = title_with_gemini(key, model, row["seed"]) if key else f"[dry] {row['seed'][:40]}"
        if not new:
            print(f"  skip {row['id']}  (small talk — keeping {row['title']!r})")
            continue
        print(f"  {row['id']}  {row['title']!r} -> {new!r}")
        if apply:
            # auto-title path: rows keep user provenance only via set_session_title;
            # rename script uses the auto path so future llm auto-titles can still improve.
            conn.execute(
                "update sessions set title = ?, title_source = 'llm' where id = ?",
                (new, row["id"]))
            changed += 1
    if apply:
        conn.commit()
    print(f"{'renamed' if apply else 'would rename'}: {changed if apply else len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
