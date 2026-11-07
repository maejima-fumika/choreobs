"""Draws the figures of plot.py for the ESP32 sweep of B sensor-fusion, next to the host.

    python benchmarks/plot_esp32.py [--esp32 RUNS_JSONL] [--host RUNS_JSONL] [--out DIR] [--png]

--esp32 is the runs.jsonl of the sweep with the sensors on ESP32 boards
(benchmarks/results/esp32x3-B/runs.jsonl by default), --host that of a host
sweep (benchmarks/results/pilot-20261008-3/runs.jsonl by default). The figures
are written to DIR (figs-paper/ next to the ESP32 runs by default):

  exec-time.pdf      execution time relative to 0%, split into the time outside
                     and inside the communication API: B on the host, and B
                     with its sensors on ESP32 boards
  communication.pdf  calls of the communication API relative to 0%, by kind, on
                     the ESP32 boards: over all endpoints, and at the busiest
                     sensor, whose calls each cross Bluetooth

The ESP32 sweep has 0%, 50% and 100% only; the host sweep every 10%. There is
no memory figure: the boards do not report what they allocate.
Uses the style and helpers of plot.py.
"""

import argparse
import collections
import json
import statistics
from pathlib import Path

import numpy as np

import plot
from plot import plt

BENCH = "b-sensor-fusion"
SENSORS = ("sensor1", "sensor2", "sensor3")
KINDS = ("send", "broadcast", "receive")
COLORS = {"send": plot.BLUE, "broadcast": plot.ORANGE, "receive": plot.AQUA}


def fractions_of(runs):
    return sorted({k[2] for k in runs if k[0] == BENCH})


def exec_series(time_runs, profile_runs, fractions):
    """As plot.exec_series, at the fractions the sweep has."""
    base = statistics.median(plot.exec_ms(r) for r in time_runs[(BENCH, None, 0.0)])
    total, q1, q3, lower = [], [], [], []
    for p in fractions:
        keys = plot.configs(time_runs, BENCH, p)
        t = [statistics.median(plot.exec_ms(r) for r in time_runs[k]) / base for k in keys]
        o = [ti * statistics.median(plot.outside_share(r) for r in profile_runs[k]) for ti, k in zip(t, keys)]
        total.append(statistics.median(t))
        lo, hi = plot.quartiles(t)
        q1.append(lo)
        q3.append(hi)
        lower.append(statistics.median(o))
    return np.array(total), np.array(q1), np.array(q3), np.array(lower)


def busiest_sensor(eps):
    """The sensor endpoint with the most calls: each tick waits for it."""
    sensors = [e for name, e in eps.items() if name in SENSORS]
    return max(sensors, key=lambda e: sum(e["profile"][f"{k}_n"] for k in KINDS))


def comm_series(profile_runs, fractions, pick):
    """As plot.comm_series, over the endpoints `pick` chooses from a run."""
    calls = lambda eps, kind: sum(e["profile"][f"{kind}_n"] for e in pick(eps))
    base_run = profile_runs[(BENCH, None, 0.0)][0]
    base = sum(calls(base_run, k) for k in KINDS)
    layers = {k: [] for k in KINDS}
    q1, q3 = [], []
    for p in fractions:
        runs = [profile_runs[k][0] for k in plot.configs(profile_runs, BENCH, p)]
        for kind in layers:
            layers[kind].append(statistics.mean(calls(r, kind) for r in runs) / base)
        lo, hi = plot.quartiles([sum(calls(r, k) for k in KINDS) / base for r in runs])
        q1.append(lo)
        q3.append(hi)
    return {k: np.array(v) for k, v in layers.items()}, np.array(q1), np.array(q3)


def load_named(path):
    """Profile runs with their endpoints by name, for picking the sensors."""
    runs = collections.defaultdict(list)
    for line in open(path):
        run = json.loads(line)
        if run["status"] == "ok" and run["mode"] == "profile" and run["bench"].split("/")[-1] == BENCH:
            runs[(BENCH, run["seed"], round(run["p"], 2))].append(run["endpoints"])
    return runs


def grid(titles, ylabel):
    fig, axes = plt.subplots(
        1, len(titles), figsize=(plot.TEXT_WIDTH_IN, 1.9), sharex=True, sharey=True,
        gridspec_kw={"wspace": 0.12, "left": 0.08, "right": 0.975, "bottom": 0.2, "top": 0.78},
    )
    for ax, title in zip(axes, titles):
        ax.set_title(title, pad=3)
        ax.set_xlim(0, 100)
        ax.set_xticks([0, 50, 100])
        ax.margins(x=0)
    fig.supylabel(ylabel, fontsize=7.5, x=0.0, ha="left")
    fig.supxlabel(r"Locations made \texttt{dyn} (\%)", fontsize=7.5, y=0.04, va="bottom")
    return fig, axes


def plot_exec(sweeps, out, png):
    fig, axes = grid([title for title, _, _ in sweeps], r"Time relative to 0\%")
    for ax, (_, time_runs, profile_runs) in zip(axes, sweeps):
        fractions = fractions_of(time_runs)
        x = np.array(fractions) * 100
        total, q1, q3, lower = exec_series(time_runs, profile_runs, fractions)
        ax.fill_between(x, lower, total, color=plot.BLUE_LIGHT, linewidth=0, zorder=2)
        ax.fill_between(x, 0, lower, color=plot.BLUE_DARK, linewidth=0, zorder=2)
        ax.plot(x, lower, color="white", linewidth=0.4, zorder=2.5)  # gap between the layers
        plot.baseline(ax)
        plot.total_line(ax, x, total, q1, q3)
    axes[0].set_ylim(0, 2.9)
    axes[0].set_yticks([0, 1, 2])
    plot.legend(fig, [
        plot.patch(plot.BLUE_DARK, "Outside the communication API"),
        plot.patch(plot.BLUE_LIGHT, "Inside it (waiting included)"),
        plot.total_handle("Total (median)"),
        plot.patch(plot.MUTED, "IQR over seeds", alpha=0.28),
    ])
    plot.save(fig, out, "exec-time", png)


def plot_comm(named_runs, out, png):
    panels = [
        ("All endpoints", lambda eps: list(eps.values())),
        ("Busiest sensor (on an ESP32)", lambda eps: [busiest_sensor(eps)]),
    ]
    fig, axes = grid([title for title, _ in panels], r"Calls relative to 0\%")
    fractions = fractions_of(named_runs)
    x = np.array(fractions) * 100
    for ax, (_, pick) in zip(axes, panels):
        layers, q1, q3 = comm_series(named_runs, fractions, pick)
        bottom = np.zeros_like(x)
        for kind, color in COLORS.items():
            top = bottom + layers[kind]
            ax.fill_between(x, bottom, top, color=color, alpha=0.85, linewidth=0, zorder=2)
            ax.plot(x, top, color="white", linewidth=0.4, zorder=2.5)
            bottom = top
        plot.baseline(ax)
        ax.fill_between(x, q1, q3, color=plot.MUTED, alpha=0.28, linewidth=0, zorder=4)
        ax.plot(x, bottom, color=plot.INK, linewidth=1.0, marker="o", markersize=2.2, zorder=5)
    axes[0].set_ylim(0, 2.9)
    axes[0].set_yticks([0, 1, 2])
    plot.legend(fig, [
        plot.patch(plot.BLUE, "send", alpha=0.85),
        plot.patch(plot.ORANGE, "broadcast", alpha=0.85),
        plot.patch(plot.AQUA, "receive", alpha=0.85),
        plot.total_handle("Total (mean)"),
        plot.patch(plot.MUTED, "IQR of the total over seeds", alpha=0.28),
    ])
    plot.save(fig, out, "communication", png)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--esp32", type=Path, default=plot.HERE / "results" / "esp32x3-B" / "runs.jsonl")
    parser.add_argument("--host", type=Path, default=plot.DEFAULT_RUNS)
    parser.add_argument("--out", type=Path, help="default: figs-paper/ next to the ESP32 runs")
    parser.add_argument("--png", action="store_true", help="also write 300 dpi PNG previews")
    args = parser.parse_args()
    args.out = args.out or args.esp32.parent / "figs-paper"
    args.out.mkdir(parents=True, exist_ok=True)
    host = plot.load(args.host)
    esp32 = plot.load(args.esp32)
    plot_exec([
        (r"Host (\textsc{ticks} = 800)", *host),
        (r"Sensors on ESP32 boards (\textsc{ticks} = 80)", *esp32),
    ], args.out, args.png)
    plot_comm(load_named(args.esp32), args.out, args.png)


if __name__ == "__main__":
    main()
