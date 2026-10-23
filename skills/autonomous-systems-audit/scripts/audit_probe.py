#!/usr/bin/env python3
"""Read-only telemetry probe for autonomous-systems-audit. Never mutates state/ or repo files."""
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path("/home/chris2/dev/CC-MAESTRO")
CLAUDE = Path("/home/chris2/.claude")
METER = Path("/home/chris2/.local/state/graphify-context-meter.log")


def main():
    out = {"repo_root": str(ROOT)}

    # 1. Runtime & clean_day (--no-tests for fast log check; full suite run in Step 2)
    cd_script = ROOT / "tools/clean_day.py"
    if cd_script.exists():
        r = subprocess.run(
            [sys.executable, str(cd_script), "--no-tests"],
            capture_output=True, text=True, timeout=30
        )
        out["clean_day_no_tests"] = {"rc": r.returncode, "output": (r.stdout + r.stderr).strip()}

    relaunch = []
    relaunch_dir = ROOT / "state/relaunch"
    if relaunch_dir.exists():
        def _log_key(p: Path):
            m = re.search(r"-(\d{8}-\d{6})\.log$", p.name)
            return m.group(1) if m else p.name
        for p in sorted(relaunch_dir.glob("*.log"), key=_log_key)[-10:]:
            txt = p.read_text(errors="replace")
            btd = re.findall(r"boot_to_drive=([\d.]+)s", txt)
            res = re.findall(r"RESULT:\s*(\w+)", txt)
            relaunch.append({
                "log": p.name,
                "boot_to_drive_s": float(btd[-1]) if btd else None,
                "result": res[-1] if res else None,
            })
    out["recent_relaunches"] = relaunch

    # 2. State hygiene: check state/*.jsonl for leaked synthetic test panes
    st_path = ROOT / "state/send-timing.jsonl"
    if st_path.exists():
        lines = st_path.read_text(errors="replace").splitlines()
        leaks = []
        for l in lines:
            if re.search(r'"pane"\s*:\s*"[^"]*(test|fake|dummy)[^"]*"', l, re.I):
                try:
                    leaks.append(json.loads(l))
                except Exception:
                    leaks.append({"raw": l})
        out["send_timing"] = {
            "total_rows": len(lines),
            "test_leak_rows": len(leaks),
            "last_leak_ts": leaks[-1].get("ts") if leaks else None,
        }

    # 3. Graphify corpus & freshness
    fresh_path = ROOT / "graphify-out/.freshness.json"
    fresh_data = None
    if fresh_path.exists():
        try:
            fresh_data = json.loads(fresh_path.read_text(errors="replace"))
        except Exception as e:
            fresh_data = {"error": str(e)}

    g_path = ROOT / "graphify-out/graph.json"
    if g_path.exists():
        g_json = json.loads(g_path.read_text(errors="replace"))
        nodes = g_json.get("nodes", [])
        edges = g_json.get("edges", g_json.get("links", []))
        c = Counter()
        for n in nodes:
            sf = n.get("source_file") or ""
            for prefix in ("wiki/archive/", "tools/archive/", "state/jev-inputs/", "reviews/archive/", "reviews/pme-assessment"):
                if sf.startswith(prefix):
                    c[prefix.rstrip("/")] += 1
                    break
            else:
                c[sf.split("/")[0] if "/" in sf else sf] += 1
        out["graphify"] = {
            "freshness": fresh_data,
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "top_prefixes": dict(c.most_common(12)),
        }

    # 4. Graphify context meter log
    if METER.exists():
        m_lines = METER.read_text(errors="replace").splitlines()
        so = [l for l in m_lines if "session-orientation" in l]
        fs = [l for l in m_lines if "first-search" in l]
        stale = [l for l in so if '"status":"stale"' in l]
        stale_c0 = [l for l in stale if '"code":"0"' in l and '"deleted":"0"' in l]
        out["meter"] = {
            "total_events": len(m_lines),
            "session_orientation": len(so),
            "first_search": len(fs),
            "stale": len(stale),
            "stale_with_code0_del0": len(stale_c0),
            "current": sum(1 for l in so if '"status":"current"' in l),
            "docs_pending": sum(1 for l in so if '"status":"docs-pending"' in l),
            "refreshing_docs_only": sum(1 for l in so if "refreshing (docs only)" in l),
            "first_search_no_match_bytes24": sum(1 for l in fs if "bytes=24" in l),
        }

    # 5. Dead post-PR.3 wiki reference check
    dead_refs = []
    for path, pat in [
        (CLAUDE / "hooks/session-context.sh", r"wiki/projects"),
        (Path("/home/chris2/.config/agent-context/INSTRUCTIONS.md"), r"wiki/inbox\.md"),
        (ROOT / "queue/loop-prompt.md", r"wiki rules/truth-and-done\.md"),
    ]:
        if path.exists():
            for lineno, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
                if re.search(pat, line):
                    dead_refs.append({"file": str(path), "line": lineno, "match": pat})
    out["dead_wiki_refs"] = dead_refs

    # 6. Graphify CLI & skill version drift check + KY Gemini note check
    gv = subprocess.run(["graphify", "--version"], capture_output=True, text=True)
    gh = subprocess.run(["graphify", "--help"], capture_output=True, text=True)
    ky_skill = CLAUDE / "skills/graphify/SKILL.md"
    ky_present = False
    if ky_skill.exists():
        ky_present = "gemini-3.8-flash" in ky_skill.read_text(errors="replace")
    out["graphify_skill_health"] = {
        "version_stdout": gv.stdout.strip(),
        "stderr_warnings": [l for l in (gv.stderr + gh.stderr).splitlines() if l.strip()],
        "claude_ky_gemini_note_present": ky_present,
    }

    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
