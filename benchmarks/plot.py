"""Draws the three evaluation figures of the PLDI 2027 paper from the runs of a benchmark sweep.

    python benchmarks/plot.py [RUNS_JSONL] [--out DIR] [--png]

RUNS_JSONL is the runs.jsonl written by `npm run bench`
(benchmarks/results/pilot-20261008-3/runs.jsonl by default). The figures are
written to DIR (figs-paper/ next to RUNS_JSONL by default):

  exec-time.pdf      execution time relative to 0%, split into the time outside
                     and inside the communication API
  communication.pdf  calls of the communication API relative to 0%, by kind
  memory.pdf         megabytes allocated, on one linear axis for every benchmark

Each figure has one panel per macro benchmark, with the fraction of locations
made dyn on the x axis. Text is typeset by LaTeX with Libertine, as in the paper.
Needs matplotlib and numpy.
"""

import argparse
import collections
import json
import statistics
from pathlib import Path

import matplotlib

matplotlib.use("pdf")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

HERE = Path(__file__).resolve().parent
DEFAULT_RUNS = HERE / "results" / "pilot-20261008-3" / "runs.jsonl"

# Directory name in ChoreoBS -> panel title.
BENCHES = {
    "a-smallbank-2pc": "A smallbank",
    "b-sensor-fusion": "B sensor-fusion",
    "c-replicated-kvs": "C replicated-kvs",
    "d-kmeans": "D kmeans",
    "e-sample-sort": "E sample-sort",
    "f-jacobi": "F jacobi",
    "g-secure-aggregation": "G secure-agg.",
    "h-job-dispatcher": "H job-dispatcher",
}
FRACTIONS = [i / 10 for i in range(11)]

TEXT_WIDTH_IN = 395.8225 / 72.27  # \textwidth of acmsmall
INK = "#0b0b0b"
MUTED = "#52514e"
GRID = "#e4e3de"
BLUE_DARK = "#256abf"  # blue ramp step 500
BLUE_LIGHT = "#b7d3f6"  # blue ramp step 150
BLUE = "#2a78d6"  # categorical slot 1
ORANGE = "#eb6834"  # categorical slot 2
AQUA = "#1baf7a"  # categorical slot 3

plt.rcParams.update({
    "text.usetex": True,
    "text.latex.preamble": r"\usepackage[tt=false,type1]{libertine}\usepackage[libertine]{newtxmath}",
    "font.family": "serif",
    "font.size": 8,
    "axes.titlesize": 8,
    "axes.labelsize": 7.5,
    "xtick.labelsize": 7,
    "ytick.labelsize": 7,
    "legend.fontsize": 7.5,
    "axes.edgecolor": "#a8a7a2",
    "axes.linewidth": 0.5,
    "axes.labelcolor": INK,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "xtick.major.size": 0,
    "ytick.major.size": 0,
    "xtick.major.pad": 2,
    "ytick.major.pad": 2,
    "axes.grid": True,
    "axes.grid.axis": "y",
    "grid.color": GRID,
    "grid.linewidth": 0.5,
    "axes.axisbelow": True,
    "legend.frameon": False,
})


# ---------------------------------------------------------------------------
# Loading


def load(path):
    """Returns the valid runs grouped by (bench, seed, p) and mode."""
    time_runs = collections.defaultdict(list)
    profile_runs = collections.defaultdict(list)
    for line in open(path):
        run = json.loads(line)
        if run["status"] != "ok":
            continue
        bench = run["bench"].split("/")[-1]
        if bench not in BENCHES:
            continue
        key = (bench, run["seed"], round(run["p"], 2))
        eps = list(run["endpoints"].values())
        (time_runs if run["mode"] == "time" else profile_runs)[key].append(eps)
    return time_runs, profile_runs


def configs(runs, bench, p):
    """Keys of the configurations of a benchmark at fraction p (one per seed; one in all at 0% and 100%)."""
    return [k for k in runs if k[0] == bench and k[2] == round(p, 2)]


def quartiles(values):
    if len(values) == 1:
        return values[0], values[0]
    q = statistics.quantiles(values, n=4, method="inclusive")
    return q[0], q[2]


# ---------------------------------------------------------------------------
# Measures of one run


def exec_ms(eps):
    """A run takes as long as its slowest endpoint."""
    return max(e["exec_ms"] for e in eps)


def comm_api_ms(e):
    pr = e["profile"]
    return pr["send_ms"] + pr["receive_ms"] + pr["broadcast_ms"]


def outside_share(eps):
    """Share of time outside the communication API, at the endpoint where that time is longest."""
    e = max(eps, key=lambda e: e["exec_ms"] - comm_api_ms(e))
    return (e["exec_ms"] - comm_api_ms(e)) / e["exec_ms"]


def calls(eps, kind):
    return sum(e["profile"][f"{kind}_n"] for e in eps)


def alloc_words(eps):
    return sum(e["alloc_words"] for e in eps)


# ---------------------------------------------------------------------------
# Series


def exec_series(time_runs, profile_runs, bench):
    """Total (median over seeds) with its quartiles, and the part outside the communication API."""
    base = statistics.median(exec_ms(r) for r in time_runs[(bench, None, 0.0)])
    total, q1, q3, lower = [], [], [], []
    for p in FRACTIONS:
        keys = configs(time_runs, bench, p)
        t = [statistics.median(exec_ms(r) for r in time_runs[k]) / base for k in keys]
        o = [ti * statistics.median(outside_share(r) for r in profile_runs[k]) for ti, k in zip(t, keys)]
        total.append(statistics.median(t))
        lo, hi = quartiles(t)
        q1.append(lo)
        q3.append(hi)
        lower.append(statistics.median(o))
    return np.array(total), np.array(q1), np.array(q3), np.array(lower)


def comm_series(profile_runs, bench):
    """Calls of each kind (mean over seeds, so the layers add up) and the quartiles of the total."""
    base_run = profile_runs[(bench, None, 0.0)][0]
    base = sum(calls(base_run, k) for k in ("send", "broadcast", "receive"))
    layers = {k: [] for k in ("send", "broadcast", "receive")}
    q1, q3 = [], []
    for p in FRACTIONS:
        keys = configs(profile_runs, bench, p)
        runs = [profile_runs[k][0] for k in keys]  # counts do not depend on timing: one profile run each
        for kind in layers:
            layers[kind].append(statistics.mean(calls(r, kind) for r in runs) / base)
        lo, hi = quartiles([sum(calls(r, k) for k in layers) / base for r in runs])
        q1.append(lo)
        q3.append(hi)
    return {k: np.array(v) for k, v in layers.items()}, np.array(q1), np.array(q3)


def memory_series(time_runs, bench):
    """Megabytes allocated by all endpoints (median over seeds) with its quartiles. A word is 4 bytes."""
    mb = lambda words: words * 4 / 2**20
    med, q1, q3 = [], [], []
    for p in FRACTIONS:
        sizes = [mb(statistics.median(alloc_words(r) for r in time_runs[k])) for k in configs(time_runs, bench, p)]
        med.append(statistics.median(sizes))
        lo, hi = quartiles(sizes)
        q1.append(lo)
        q3.append(hi)
    return np.array(med), np.array(q1), np.array(q3)


# ---------------------------------------------------------------------------
# Drawing


def grid(height_in, ylabel):
    fig, axes = plt.subplots(
        2, 4, figsize=(TEXT_WIDTH_IN, height_in), sharex=True, sharey=True,
        gridspec_kw={"wspace": 0.2, "hspace": 0.45, "left": 0.07, "right": 0.975, "bottom": 0.12, "top": 0.84},
    )
    for ax, title in zip(axes.flat, BENCHES.values()):
        ax.set_title(title, pad=3)
        ax.set_xlim(0, 100)
        ax.set_xticks([0, 50, 100])
        ax.margins(x=0)
    fig.supylabel(ylabel, fontsize=7.5, x=0.0, ha="left")
    fig.supxlabel(r"Locations made \texttt{dyn} (\%)", fontsize=7.5, y=0.0, va="bottom")
    return fig, axes


def baseline(ax):
    ax.axhline(1, color=INK, linewidth=0.6, dashes=(2.5, 1.8), alpha=0.75, zorder=3)


def total_line(ax, x, y, q1, q3):
    ax.fill_between(x, q1, q3, color=MUTED, alpha=0.28, linewidth=0, zorder=4)
    ax.plot(x, y, color=INK, linewidth=1.0, marker="o", markersize=2.2, zorder=5)


def save(fig, out, name, png):
    # No tight bounding box: every figure keeps the same size, the width of the text.
    fig.savefig(out / f"{name}.pdf")
    if png:
        fig.savefig(out / f"{name}.png", dpi=300)
    plt.close(fig)


def plot_exec(time_runs, profile_runs, out, png):
    fig, axes = grid(2.55, r"Time relative to 0\%")
    x = np.array(FRACTIONS) * 100
    for ax, bench in zip(axes.flat, BENCHES):
        total, q1, q3, lower = exec_series(time_runs, profile_runs, bench)
        ax.fill_between(x, lower, total, color=BLUE_LIGHT, linewidth=0, zorder=2)
        ax.fill_between(x, 0, lower, color=BLUE_DARK, linewidth=0, zorder=2)
        ax.plot(x, lower, color="white", linewidth=0.4, zorder=2.5)  # gap between the layers
        baseline(ax)
        total_line(ax, x, total, q1, q3)
    axes[0, 0].set_ylim(0, 1.9)
    axes[0, 0].set_yticks([0, 0.5, 1, 1.5])
    legend(fig, [
        patch(BLUE_DARK, "Outside the communication API"),
        patch(BLUE_LIGHT, "Inside it (waiting included)"),
        total_handle("Total (median)"),
        patch(MUTED, "IQR over seeds", alpha=0.28),
    ])
    save(fig, out, "exec-time", png)


def plot_comm(profile_runs, out, png):
    fig, axes = grid(2.55, r"Calls relative to 0\%")
    x = np.array(FRACTIONS) * 100
    colors = {"send": BLUE, "broadcast": ORANGE, "receive": AQUA}
    for ax, bench in zip(axes.flat, BENCHES):
        layers, q1, q3 = comm_series(profile_runs, bench)
        bottom = np.zeros_like(x)
        for kind, color in colors.items():
            top = bottom + layers[kind]
            ax.fill_between(x, bottom, top, color=color, alpha=0.85, linewidth=0, zorder=2)
            ax.plot(x, top, color="white", linewidth=0.4, zorder=2.5)
            bottom = top
        baseline(ax)
        ax.fill_between(x, q1, q3, color=MUTED, alpha=0.28, linewidth=0, zorder=4)
        ax.plot(x, bottom, color=INK, linewidth=1.0, marker="o", markersize=2.2, zorder=5)
    axes[0, 0].set_ylim(0, 2.9)
    axes[0, 0].set_yticks([0, 1, 2])
    legend(fig, [
        patch(BLUE, "send", alpha=0.85),
        patch(ORANGE, "broadcast", alpha=0.85),
        patch(AQUA, "receive", alpha=0.85),
        total_handle("Total (mean)"),
        patch(MUTED, "IQR of the total over seeds", alpha=0.28),
    ])
    save(fig, out, "communication", png)


def plot_memory(time_runs, out, png):
    """Megabytes allocated, on one linear axis shared by every panel."""
    fig, axes = grid(2.55, "Allocated during a run (MB)")
    x = np.array(FRACTIONS) * 100
    highest = 0.0
    for ax, bench in zip(axes.flat, BENCHES):
        med, q1, q3 = memory_series(time_runs, bench)
        highest = max(highest, q3.max())
        ax.axhline(med[0], color=INK, linewidth=0.6, dashes=(2.5, 1.8), alpha=0.75, zorder=3)  # the 0% level
        ax.fill_between(x, q1, q3, color=BLUE, alpha=0.25, linewidth=0, zorder=4)
        ax.plot(x, med, color=BLUE, linewidth=1.0, marker="o", markersize=2.2, zorder=5)
    top = 10 * np.ceil(highest / 10)  # ticks every 10 MB, up to the highest quartile
    axes[0, 0].set_ylim(0, top)
    axes[0, 0].set_yticks(np.arange(0, top + 1, 10))
    legend(fig, [
        total_handle("Median over seeds", color=BLUE),
        patch(BLUE, "IQR over seeds", alpha=0.25),
    ])
    save(fig, out, "memory", png)


def patch(color, label, alpha=1.0):
    return matplotlib.patches.Patch(facecolor=color, alpha=alpha, linewidth=0, label=label)


def total_handle(label, color=INK):
    return matplotlib.lines.Line2D([], [], color=color, linewidth=1.0, marker="o", markersize=2.2, label=label)


def legend(fig, handles):
    fig.legend(
        handles=handles, loc="upper center", bbox_to_anchor=(0.53, 1.0), ncol=len(handles),
        handlelength=1.4, handletextpad=0.5, columnspacing=1.2,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("runs", nargs="?", type=Path, default=DEFAULT_RUNS)
    parser.add_argument("--out", type=Path, help="default: figs-paper/ next to RUNS_JSONL")
    parser.add_argument("--png", action="store_true", help="also write 300 dpi PNG previews")
    args = parser.parse_args()
    args.out = args.out or args.runs.parent / "figs-paper"
    args.out.mkdir(parents=True, exist_ok=True)
    time_runs, profile_runs = load(args.runs)
    plot_exec(time_runs, profile_runs, args.out, args.png)
    plot_comm(profile_runs, args.out, args.png)
    plot_memory(time_runs, args.out, args.png)


if __name__ == "__main__":
    main()
