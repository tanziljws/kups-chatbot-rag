#!/usr/bin/env python3
"""Measure this project's Next.js process tree and llama-server RSS."""

from pathlib import Path
import re
import subprocess
import sys


next_command = re.compile(r"(?:^|[\s/])next(?:\.js)?\s+(?:dev|start)(?:\s|$)")

try:
    ps_output = subprocess.check_output(
        ["ps", "-Ao", "pid=,ppid=,rss=,command="], text=True
    )
except (OSError, subprocess.CalledProcessError) as error:
    print(f"Unable to read process RSS: {error}", file=sys.stderr)
    sys.exit(2)

processes = {}
for line in ps_output.splitlines():
    fields = line.strip().split(None, 3)
    if len(fields) != 4:
        continue
    try:
        pid, ppid, rss_kib = map(int, fields[:3])
    except ValueError:
        continue
    processes[pid] = {"ppid": ppid, "rss": rss_kib, "command": fields[3]}

app_roots = {
    pid
    for pid, process in processes.items()
    if next_command.search(process["command"])
}
app_pids = set(app_roots)
while True:
    descendants = {
        pid for pid, process in processes.items() if process["ppid"] in app_pids
    }
    new_pids = descendants - app_pids
    if not new_pids:
        break
    app_pids.update(new_pids)

model_pids = {
    pid
    for pid, process in processes.items()
    if Path(process["command"].split()[0]).name == "llama-server"
}
selected_pids = app_pids | model_pids

missing = []
if not app_roots:
    missing.append("this project's Next.js server")
if not model_pids:
    missing.append("llama-server")
if missing:
    print(
        "Start " + " and ".join(missing) + " before measuring memory.",
        file=sys.stderr,
    )
    sys.exit(2)

total_kib = sum(processes[pid]["rss"] for pid in selected_pids)
used_mib = total_kib / 1024
limit_mib = 1638
print(
    f"This project's Next.js tree + llama-server RSS: "
    f"{used_mib:.0f} MiB (limit {limit_mib} MiB)"
)

if total_kib > limit_mib * 1024:
    print(
        "Memory target exceeded; reduce the local model footprint or add RAM before launch.",
        file=sys.stderr,
    )
    sys.exit(1)
