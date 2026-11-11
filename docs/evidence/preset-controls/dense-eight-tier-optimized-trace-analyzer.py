#!/usr/bin/env python3
"""Read-only CLI-process analysis; writes JSON only to stdout unless --output is set.

Usage:
  python3 /tmp/connect-dense-trace-analysis.py \
    docs/evidence/preset-controls/dense-eight-tier-live.json > /tmp/dense-analysis.json

No CLI is launched. Archive lines are streamed and stream bodies discarded after
extracting presence, byte counts and truncation flags. Process overlap uses
cli.started.data.started -> cli.finished.data.ended, never wrapper task lifetimes.
"""
import argparse
import bisect
import math
import re
from collections import Counter, defaultdict
import json
from pathlib import Path
import sys

MAX_LINE_BYTES = 2 * 1024 * 1024
MAX_INVOCATIONS = 250000
HISTORY_OPERATIONS = {("file", "write"), ("branch", "fork"),
                      ("branch", "merge"), ("branch", "publish")}


def integer(value):
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def stream_meta(value):
    return {
        "present": isinstance(value, dict) and isinstance(value.get("text"), str),
        "bytes": value.get("bytes", 0) if isinstance(value, dict) else 0,
        "truncated": bool(value.get("truncated")) if isinstance(value, dict) else False,
    }


def failure(call):
    if not call.get("finishedCount"):
        return False
    return (call.get("status") != "success"
            or call.get("exitCode") not in (None, 0)
            or call.get("commandExitCode") not in (None, 0))


def process_analysis(calls):
    deltas = Counter()
    intervals = []
    invalid, zero = 0, 0
    for call in calls:
        start, end = call.get("started"), call.get("ended")
        if start is None or end is None or end < start:
            invalid += 1
            continue
        intervals.append((start, end))
        if end == start:
            zero += 1
        else:
            deltas[start] += 1
            deltas[end] -= 1
    if not intervals:
        return {"processes": 0, "peak": 0, "invalidIntervals": invalid,
                "zeroDurationIntervals": zero, "durationsMsByConcurrentProcessCount": {}}
    first = min(start for start, _ in intervals)
    last = max(end for _, end in intervals)
    active, peak, previous = 0, 0, first
    durations = Counter()
    peak_at = None
    # Aggregate equal timestamps: intervals are half-open, so an ending process
    # does not overlap a different process starting at the same millisecond.
    for at in sorted(deltas):
        if at > previous:
            durations[active] += at - previous
        active += deltas[at]
        if active > peak:
            peak, peak_at = active, at
        previous = at
    if last > previous:
        durations[active] += last - previous
    elapsed = last - first
    process_ms = sum(end - start for start, end in intervals)
    return {
        "processes": len(intervals), "firstStarted": first, "lastEnded": last,
        "elapsedMs": elapsed, "peak": peak, "firstPeakAt": peak_at,
        "totalProcessMs": process_ms,
        "meanConcurrentProcesses": round(process_ms / elapsed, 6) if elapsed else None,
        "durationsMsByConcurrentProcessCount": {str(count): durations[count]
                                                for count in sorted(durations)},
        "percentOfElapsedByConcurrentProcessCount": {
            str(count): round(100 * duration / elapsed, 6) if elapsed else None
            for count, duration in sorted(durations.items())},
        "invalidIntervals": invalid, "zeroDurationIntervals": zero,
        "finalActiveProcesses": active,
    }


def accounting(calls):
    values = list(calls)
    counts = {
        "uniqueInvocations": len(values),
        "queued": sum(bool(call["queuedCount"]) for call in values),
        "started": sum(bool(call["startedCount"]) for call in values),
        "finished": sum(bool(call["finishedCount"]) for call in values),
        "queuedEvents": sum(call["queuedCount"] for call in values),
        "startedEvents": sum(call["startedCount"] for call in values),
        "finishedEvents": sum(call["finishedCount"] for call in values),
        "duplicateLifecycleRecords": sum(max(0, call[key] - 1) for call in values
                                          for key in ("queuedCount", "startedCount", "finishedCount")),
        "missingLifecycleInvocations": sum(not all(call[key] == 1 for key in
            ("queuedCount", "startedCount", "finishedCount")) for call in values),
        "failedInvocations": sum(failure(call) for call in values),
        "stdinPresent": sum(call.get("stdin", {}).get("present", False) for call in values),
        "stdoutPresent": sum(call.get("stdout", {}).get("present", False) for call in values),
        "stderrPresent": sum(call.get("stderr", {}).get("present", False) for call in values),
        "bothOutputStreamsPresent": sum(call.get("stdout", {}).get("present", False)
            and call.get("stderr", {}).get("present", False) for call in values),
        "stdinTruncated": sum(call.get("stdin", {}).get("truncated", False) for call in values),
        "stdoutTruncated": sum(call.get("stdout", {}).get("truncated", False) for call in values),
        "stderrTruncated": sum(call.get("stderr", {}).get("truncated", False) for call in values),
        "stdoutBytes": sum(call.get("stdout", {}).get("bytes", 0) for call in values),
        "stderrBytes": sum(call.get("stderr", {}).get("bytes", 0) for call in values),
    }
    counts["statuses"] = dict(sorted(Counter(call.get("status", "unfinished") for call in values).items()))
    return counts



def distribution(values):
    values = sorted(value for value in values if isinstance(value, (int, float)))
    if not values:
        return {"count": 0}
    def percentile(fraction):
        position = (len(values) - 1) * fraction
        low, high = math.floor(position), math.ceil(position)
        return round(values[low] + (values[high] - values[low]) * (position - low), 4)
    return {"count": len(values), "sum": sum(values), "mean": round(sum(values)/len(values), 4),
            "min": values[0], "p50": percentile(.5), "p90": percentile(.9),
            "p99": percentile(.99), "max": values[-1]}


def cost_summary(calls):
    calls = sorted(calls, key=lambda call: (call.get("started", 0), call["id"]))
    runtimes = [call["ended"] - call["started"] for call in calls
                if call.get("started") is not None and call.get("ended") is not None]
    groups = defaultdict(list)
    for call in calls:
        groups[call.get("operation", "unknown")].append(call)
    return {
        "commands": len(calls), "processMs": distribution(runtimes),
        "queuedToStartedMs": distribution(call.get("waitMs") for call in calls),
        "activeProcessesAtStart": distribution(call.get("activeAtStart") for call in calls),
        "operations": {operation: {
            "commands": len(group),
            "processMs": distribution(call["ended"] - call["started"] for call in group
                                      if call.get("started") is not None and call.get("ended") is not None),
            "queuedToStartedMs": distribution(call.get("waitMs") for call in group),
        } for operation, group in sorted(groups.items())},
    }


def quarters(calls):
    calls = sorted(calls, key=lambda call: (call.get("started", 0), call["id"]))
    return [{"quarter": index+1, **cost_summary(calls[len(calls)*index//4:len(calls)*(index+1)//4])}
            for index in range(4)]


def slope(points):
    if len(points) < 2:
        return None
    xmean = sum(x for x, _ in points)/len(points)
    ymean = sum(y for _, y in points)/len(points)
    xx = sum((x-xmean)**2 for x, _ in points)
    yy = sum((y-ymean)**2 for _, y in points)
    xy = sum((x-xmean)*(y-ymean) for x, y in points)
    return {"msPerCycleOLS": round(xy/xx, 6) if xx else None,
            "correlationWithCycle": round(xy/math.sqrt(xx*yy), 6) if xx and yy else None,
            "cycles": len(points)}


def cost_analysis(history, tasks, evidence):
    history = [call for call in history if call.get("started") is not None and call.get("ended") is not None]
    deltas = Counter()
    for call in history:
        if call["ended"] > call["started"]:
            deltas[call["started"]] += 1
            deltas[call["ended"]] -= 1
    times, levels, active = [], [], 0
    for at, delta in sorted(deltas.items()):
        active += delta
        times.append(at); levels.append(active)
    for call in history:
        position = bisect.bisect_right(times, call["started"]) - 1
        call["activeAtStart"] = levels[position] if position >= 0 else 0
    by_project = defaultdict(list)
    for call in history:
        by_project[call["project"]].append(call)
    projects = {}
    for project, calls in by_project.items():
        task = tasks[project]
        ordered = sorted(calls, key=lambda call: (call["started"], call["id"]))
        process_total = sum(call["ended"]-call["started"] for call in ordered)
        gaps = [max(0, right["started"]-left["ended"]) for left, right in zip(ordered, ordered[1:])]
        cycle_groups = defaultdict(list)
        concurrency_groups = defaultdict(list)
        for call in calls:
            if call.get("cycle") is not None:
                cycle_groups[call["cycle"]].append(call)
            concurrency_groups[call["activeAtStart"]].append(call)
        cycle_numbers = sorted(cycle_groups)
        cycle_reports = []
        dag_dense_ms = 0
        operation_points = defaultdict(list)
        for cycle in cycle_numbers:
            group = cycle_groups[cycle]
            summary = cost_summary(group)
            forks = sorted([call for call in group if call.get("operation") == "branch.fork"], key=lambda call: call["started"])
            elapsed = lambda rows: sum(call["ended"]-call["started"] for call in rows)
            lane_times = [elapsed([call for call in group if call.get("operation") == "file.write" and call["argv"][3] == fork["argv"][3]]) for fork in forks]
            integration_ms = elapsed([call for call in group if call["argv"][3].startswith("integration-")])
            release_ms = elapsed([call for call in group if call["argv"][3].startswith("release-")])
            if len(lane_times) == 3:
                dag_dense_ms += elapsed(forks) + max(max(lane_times[:2]) + integration_ms, lane_times[2]) + release_ms
            cycle_reports.append({"cycle": cycle, "firstStarted": min(call["started"] for call in group),
                "lastEnded": max(call["ended"] for call in group),
                "elapsedMs": max(call["ended"] for call in group)-min(call["started"] for call in group),
                **summary})
            for operation, values in summary["operations"].items():
                operation_points[operation].append((cycle, values["processMs"]["mean"]))
        cycle_quarters = []
        for index in range(4):
            numbers = cycle_numbers[len(cycle_numbers)*index//4:len(cycle_numbers)*(index+1)//4]
            group = [call for number in numbers for call in cycle_groups[number]]
            cycle_quarters.append({"quarter": index+1, "cycles": numbers, **cost_summary(group)})
        projects[project] = {"machine": task.get("machine"), "tier": task.get("tier"),
            "taskElapsedMs": task["ended"]-task["started"], "processTotalMs": process_total,
            "outsideCLIProcessMs": task["ended"]-task["started"]-sum(v for k,v in process_analysis(ordered)["durationsMsByConcurrentProcessCount"].items() if int(k)>0),
            "processOverlapMs": process_total-sum(v for k,v in process_analysis(ordered)["durationsMsByConcurrentProcessCount"].items() if int(k)>0),
            "betweenProcessesMs": distribution(gaps),
            "allCommands": cost_summary(calls), "commandQuarters": quarters(calls),
            "branchScheduling": {
                "independentFeatureAndMaintenanceWrites": cost_summary([call for call in calls if call.get("cycle") is not None and call.get("operation") == "file.write" and not call["argv"][3].startswith(("integration-", "release-"))]),
                "sequentialPublicationChainWrites": cost_summary([call for call in calls if call.get("cycle") is not None and call.get("operation") == "file.write" and call["argv"][3].startswith(("integration-", "release-"))]),
                "cycles": len(cycle_numbers), "commandsPerDenseCycle": 322,
                "fixedObservedDurationDagProcessMs": dag_dense_ms + sum(call["ended"]-call["started"] for call in calls if call.get("cycle") is None),
                "sumObservedProcessMs": process_total,
                "projectionLimits": "Hypothetical project-only unlimited branch capacity using the SAME observed process durations, excluding inter-command gaps. Three forks are a serial barrier; feature A/B/maintenance writes overlap; integration waits for A/B and release waits for integration+maintenance. No global process cap, shared-store writer locking, extra contention, or rescheduled durations are modeled. NOT a benchmark or achievable speed claim.",
                "featureLaneWritesPerCycle": [80, 80, 49],
                "publicationChainWritesPerCycle": 53,
                "publicationChainPublishesPerCycle": 55,
                "unitDepthWithSerialForkBarrier": 193,
                "qualification": "193 versus 322 is command dependency depth, not measured runtime. Branch-local writes must stay ordered; integration and release publications remain ordered. Shared SQLite writer locks and changed contention prevent translating this ratio into a speed promise."
            },
            "cycleQuarters": cycle_quarters, "cycles": cycle_reports,
            "cycleMeanLatencyTrend": {operation: slope(points) for operation, points in operation_points.items()},
            "byActiveProcessCountAtStart": {str(count): cost_summary(group)
                                           for count, group in sorted(concurrency_groups.items())}}
    machines = defaultdict(list)
    for project, calls in by_project.items():
        machines[tasks[project].get("machine", "unknown")].extend(calls)
    comparisons = {}
    website = "demo-studio/website"
    if website in by_project:
        native_peer = tasks.get("demo-studio/design", {}).get("ended")
        others = [task["ended"] for project, task in tasks.items() if project != website and task.get("ended")]
        last_peer = max(others) if others else None
        for label, at in [("nativeDesignFinished", native_peer), ("allOtherProjectsFinished", last_peer)]:
            if at is not None:
                comparisons[label] = {"at": at, "websiteRemainingTaskMs": tasks[website]["ended"]-at,
                    "before": cost_summary([call for call in by_project[website] if call["started"] < at]),
                    "after": cost_summary([call for call in by_project[website] if call["started"] >= at])}
        solo = [call for call in by_project[website] if last_peer and call["started"] >= last_peer]
        comparisons["websiteSoloTailQuarters"] = quarters(solo)
    return {"preparationMs": evidence.get("preparationMs"), "historyMs": evidence.get("historyMs"),
        "verificationMs": evidence.get("verificationMs"),
        "allHistory": cost_summary(history),
        "byMachine": {machine: cost_summary(calls) for machine, calls in sorted(machines.items())},
        "projects": projects, "websitePeerComparisons": comparisons,
        "interpretationLimits": [
            "Process lifetime includes binary startup, child-side routing, worker transport, SQLite/backend work and OS scheduling; these cannot be separated from these events alone.",
            "Queued-to-started is the recorder's admission/launch delay, not database lock wait inside the CLI process.",
            "Cycle number grows with elapsed time and history size; observed correlation is not an isolated causal benchmark.",
            "Solo-tail comparisons remove other preset CLI processes but cannot exclude unrelated host load, thermal changes, or background services.",
            "outsideCLIProcessMs subtracts the UNION of process intervals from task elapsed time; it is time with no child running, not a causal savings estimate. Overlapping child time is reported separately."]}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", nargs="?", default="docs/evidence/preset-controls/dense-eight-tier-live.json")
    parser.add_argument("--state", help="Override only the read-only state directory")
    parser.add_argument("--allow-incomplete", action="store_true")
    parser.add_argument("--output", help="Optional analysis JSON destination; archives are never modified")
    args = parser.parse_args()
    evidence_path = Path(args.evidence)
    evidence = json.loads(evidence_path.read_text())
    state = Path(args.state or evidence["state"])
    tasks = evidence.get("tasks") or evidence.get("progress", {}).get("tasks", [])
    tasks = {task["project"]: task for task in tasks}
    unfinished = [project for project, task in tasks.items()
                  if task.get("state") != "completed" or integer(task.get("started")) is None
                  or integer(task.get("ended")) is None]
    if (len(tasks) != 8 or unfinished) and not args.allow_incomplete:
        raise RuntimeError("Eight completed task windows are required; unfinished: "
                           + ", ".join(unfinished or ["missing tasks"]))
    generation_file = state / "logs" / "cli-control" / "generation.json"
    generation = json.loads(generation_file.read_text())["generation"] if generation_file.exists() else "initial"
    files = sorted((state / "logs" / "cli").glob("activity-*.ndjson"))
    calls, actions = {}, {}
    malformed, oversized, ignored_generation, read_bytes = 0, 0, 0, 0
    diagnostics = []
    for file in files:
        with file.open("rb") as source:
            line_number = 0
            while True:
                raw = source.readline(MAX_LINE_BYTES + 1)
                if not raw:
                    break
                line_number += 1
                read_bytes += len(raw)
                if len(raw) > MAX_LINE_BYTES:
                    oversized += 1
                    while raw and not raw.endswith(b"\n"):
                        raw = source.readline(MAX_LINE_BYTES + 1)
                        read_bytes += len(raw)
                    continue
                try:
                    event = json.loads(raw)
                except (ValueError, UnicodeDecodeError):
                    malformed += 1
                    if len(diagnostics) < 10:
                        diagnostics.append({"file": file.name, "line": line_number, "problem": "invalid/partial JSON"})
                    continue
                if event.get("generation", "initial") != generation:
                    ignored_generation += 1
                    continue
                action = event.get("action", {})
                kind = event.get("type")
                if action.get("name") != "demo.setup" or kind not in ("cli.queued", "cli.started", "cli.finished"):
                    continue
                invocation_id = event.get("invocationId")
                if not invocation_id:
                    continue
                if invocation_id not in calls:
                    if len(calls) >= MAX_INVOCATIONS:
                        raise RuntimeError("Metadata limit reached; refusing unbounded analysis memory")
                    calls[invocation_id] = {"id": invocation_id, "actionId": action["id"],
                        "queuedCount": 0, "startedCount": 0, "finishedCount": 0}
                call = calls[invocation_id]
                actions[action["id"]] = {"name": action.get("name"), "label": action.get("label")}
                data = event.get("data", {})
                if kind == "cli.queued":
                    call["queuedCount"] += 1
                    call["queuedAt"] = integer(event.get("at"))
                    argv = data.get("argv", [])
                    call["argv"] = argv
                    call["operation"] = ".".join(argv[:2]) if len(argv) >= 2 else "unknown"
                    call["historyMutation"] = tuple(argv[:2]) in HISTORY_OPERATIONS
                    match = re.search(r"-(\d{3})$", argv[3]) if len(argv) > 3 else None
                    call["cycle"] = int(match.group(1)) if match else None
                    call["project"] = argv[2] if len(argv) > 2 and argv[2] in tasks else None
                    call["stdin"] = stream_meta(data.get("stdin"))
                elif kind == "cli.started":
                    call["startedCount"] += 1
                    at = integer(data.get("started"))
                    if at is None:
                        at = integer(event.get("at"))
                    if at is not None:
                        call["started"] = min(call.get("started", at), at)
                    call["pid"] = data.get("pid")
                    call["waitMs"] = data.get("waitMs")
                else:
                    call["finishedCount"] += 1
                    at = integer(data.get("ended"))
                    if at is None:
                        at = integer(event.get("at"))
                    if at is not None and at >= call.get("ended", at):
                        call.update({"ended": at, "status": data.get("status"),
                            "exitCode": data.get("exitCode"), "commandExitCode": data.get("commandExitCode"),
                            "reportedDurationMs": data.get("durationMs"),
                            "stdout": stream_meta(data.get("stdout")), "stderr": stream_meta(data.get("stderr"))})
    history, outside_windows = [], []
    per_project = defaultdict(list)
    for call in calls.values():
        project = call.get("project")
        if not call.get("historyMutation") or not project:
            continue
        task = tasks[project]
        start, end = call.get("started"), call.get("ended")
        task_start, task_end = task.get("started"), task.get("ended")
        if start is not None and task_start is not None and start >= task_start and (task_end is None or start <= task_end) and (end is None or task_end is None or end <= task_end):
            history.append(call)
            per_project[project].append(call)
        else:
            outside_windows.append(call["id"])
    projects = []
    for project, task in tasks.items():
        selected = per_project[project]
        task_start, task_end = task.get("started"), task.get("ended")
        projects.append({
            "project": project, "machine": task.get("machine"), "tier": task.get("tier"),
            "taskStarted": task_start, "taskEnded": task_end,
            "taskElapsedMs": task_end - task_start if task_start is not None and task_end is not None else None,
            "expectedHistoryCommands": task.get("total"),
            "actualHistoryCommands": len(selected),
            "countMatchesTask": len(selected) == task.get("total"),
            "operations": dict(sorted(Counter(call.get("operation") for call in selected).items())),
            "fileWritesMissingStdin": sum(not call.get("stdin", {}).get("present", False)
                                          for call in selected if call.get("operation") == "file.write"),
            "accounting": accounting(selected), "processes": process_analysis(selected),
        })
    failures = [{"id": call["id"], "project": call.get("project"), "operation": call.get("operation"),
                 "status": call.get("status"), "exitCode": call.get("exitCode"),
                 "commandExitCode": call.get("commandExitCode")}
                for call in calls.values() if failure(call)]
    report = {
        "evidence": str(evidence_path.resolve()), "state": str(state), "generation": generation,
        "completeTaskWindows": len(tasks) == 8 and not unfinished,
        "method": "Stream archive lines; retain only invocation metadata. Lifetimes are cli.started.started to cli.finished.ended, half-open intervals at millisecond resolution; no task-wrapper concurrency inference.",
        "scope": "All demo.setup invocations in the current archive generation; history mutations must also fall inside their project's task window.",
        "archives": len(files), "archiveBytesRead": read_bytes, "setupActions": actions,
        "malformedLines": malformed, "oversizedLines": oversized,
        "ignoredOtherGenerationEvents": ignored_generation, "diagnostics": diagnostics,
        "allSetup": {"accounting": accounting(calls.values()), "processes": process_analysis(calls.values())},
        "history": {"accounting": accounting(history), "processes": process_analysis(history),
                    "mutationsOutsideTaskWindows": len(outside_windows),
                    "outsideWindowIds": outside_windows[:20]},
        "costAnalysis": cost_analysis(history, tasks, evidence),
        "projects": projects, "failureCount": len(failures), "failureExamples": failures[:20],
        "notes": ["Zero-millisecond intervals cannot demonstrate overlap at this timestamp resolution.",
                  "Duration histograms include count=0 gaps between CLI processes.",
                  "Output presence is checked from stored text fields; stream bodies are not retained in analyzer memory.",
                  "No claim about unique Commit or Layer IDs is inferred solely from command count; use the run's separate graph verification."],
    }
    encoded = json.dumps(report, indent=2) + "\n"
    if args.output:
        destination = Path(args.output).resolve()
        if destination == evidence_path.resolve() or state.resolve() in destination.parents:
            raise RuntimeError("Refusing to overwrite evidence or write into the analyzed state")
        destination.write_text(encoded)
    else:
        sys.stdout.write(encoded)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Analysis failed: {error}", file=sys.stderr)
        sys.exit(1)
