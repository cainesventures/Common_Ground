"""Shared guard rails for local Ollama batch runs on an 8GB card.

WHY THIS MODULE EXISTS
----------------------
Local inference on an RTX 5060 (8,151 MiB) that is also driving the desktop has
now taken this machine down many times: fine at first, then slower, then only a
hard reboot recovers it. The characteristic symptom is that the mouse still
moves but clicks do nothing — the cursor is a hardware overlay plane and keeps
being drawn, while DWM and the input stack are starved.

The mechanism, measured:

  llama3.1:8b resident          ~5.27 GB
  OLLAMA_GPU_OVERHEAD reserve    ~1.50 GB
  -------------------------------------
  committed                      ~6.77 GB of 8.15 GB
  left for the desktop           ~1.38 GB

The desktop idles at ~900 MB and Chrome + VS Code + the Claude app go well past
1.38 GB. At that point the desktop's allocations are the ones that fail.

Note what the existing guard rails do and do not cover. The NVIDIA Control
Panel profile "Prefer No Sysmem Fallback" is set for **ollama.exe**, so Ollama
cannot spiral into system RAM. It does nothing to stop Ollama *winning* the
VRAM race and starving the compositor, because the desktop processes have no
such profile. And `AI_GPU_POLICY=pause` in app/services/ai_provider.py pauses
only when a process from a hardcoded **game** list is running — so a session
where the user is simply working in Chrome and VS Code trips none of it.

Therefore the constraint has to be checked on our side, before each request,
while there is still headroom to protect. But *not* as raw free VRAM: once the
model is resident it is itself the thing consuming the headroom, so a free-VRAM
floor trips, unloads, sees the memory freed, reloads, and trips again. What
`VramGuard` measures instead is **the desktop's** usage -- total used minus our
own resident size -- and then asks whether the model would still leave
`floor_mb` on top of it. That figure does not move when we load or unload, so
the decision is stable.

KEEPING A LARGE MODEL AND A USABLE DESKTOP
------------------------------------------
A guard can only stop a run; it cannot make a model smaller. On this card
llama3.1:8b fully offloaded leaves ~1.4GB even against an idle desktop, which
is under any sane floor -- so no amount of guarding makes a full-offload 8B run
comfortable. The knob that does is `num_gpu`: keeping some layers on the CPU
trades tokens/sec for VRAM. With 128GB of system RAM, the layers that live
there cost speed, not stability. `model_peak_mb()` estimates the footprint for
a layer count; `--calibrate` in scripts/generate_insights.py measures it.

This was previously a private class inside scripts/regenerate_headlines.py.
It lives here so a new batch script does not get written without it — importing
it is less work than reinventing it.

USING IT
--------
    from gpu_guard import VramGuard, Budget, LIGHT_MODEL

    guard = VramGuard(floor_mb=1500, max_consecutive_pauses=10,
                      pause_seconds=30, unload=provider._unload)
    budget = Budget(minutes=60)

    for item in items:
        budget.check()              # raises BudgetExhausted when spent
        guard.wait_for_headroom()   # unloads + waits, or raises
        ...do one item, then commit it...

Both raise rather than degrade. Every caller must checkpoint per item so an
abort costs nothing and a re-run resumes.
"""

import logging
import subprocess
import time

log = logging.getLogger(__name__)

# llama3.2:3b (~2.0 GB) peaked at 3,206 MiB against the 8B's 6,027 MiB, and
# released back to ~970 MiB afterwards. Use it for extraction, rewriting,
# classification and summarising — anything that is not deep reasoning.
LIGHT_MODEL = "llama3.2:3b"
HEAVY_MODEL = "llama3.1:8b"

# Free VRAM to keep available for the desktop. The desktop idles near 900 MB
# and grows well past it with a browser open, so 1,500 MB is the floor for a
# run that happens while someone is using the machine. regenerate_headlines.py
# used 1,200 MB; that was measured against a quieter desktop.
DEFAULT_FLOOR_MB = 1500


class BudgetExhausted(RuntimeError):
    """The wall-clock budget ran out. Progress is checkpointed."""


class VramExhausted(RuntimeError):
    """Free VRAM stayed under the floor. Progress is checkpointed."""


class Budget:
    """A wall-clock ceiling on a run.

    An unbounded local run is the thing that keeps going wrong: a job sized in
    thousands of items will hold the model resident for hours, and the desktop
    only has to grow once for the machine to become unusable. A budget turns
    "it ran all night" into "it stopped after an hour and can be resumed".
    """

    def __init__(self, minutes: float):
        self.seconds = minutes * 60
        self.started = time.time()

    @property
    def elapsed(self) -> float:
        return time.time() - self.started

    @property
    def remaining(self) -> float:
        return max(0.0, self.seconds - self.elapsed)

    def check(self) -> None:
        if self.remaining <= 0:
            raise BudgetExhausted(
                f"Wall-clock budget of {self.seconds / 60:.0f} min is spent "
                f"({self.elapsed / 60:.1f} min elapsed). Progress is "
                "checkpointed — re-run to continue."
            )


class VramGuard:
    """Keeps a floor of free VRAM, and gives up rather than thrashing.

    The failure this exists to prevent is not an exception -- it is the driver
    quietly spilling to system RAM, or the desktop losing the allocation race,
    after which everything still "works" and the machine becomes unusable. So
    the check happens on our side, before each request, while there is still
    headroom to protect.
    """

    def __init__(self, floor_mb: int = DEFAULT_FLOOR_MB,
                 max_consecutive_pauses: int = 10,
                 pause_seconds: int = 30,
                 unload=None,
                 model_peak_mb: int = 0,
                 resident_mb=None):
        """
        model_peak_mb : what the model occupies at peak once resident. The
            decision is made as though it were loaded, so the guard behaves the
            same before the first request and between later ones.
        resident_mb : callable returning the VRAM our model holds right now
            (0 when unloaded). Used to subtract our own footprint from the
            total so the desktop's usage can be seen on its own.
        """
        self.floor_mb = floor_mb
        self.max_consecutive_pauses = max_consecutive_pauses
        self.pause_seconds = pause_seconds
        self._unload = unload or (lambda: None)
        self.model_peak_mb = model_peak_mb
        self._resident_mb = resident_mb or (lambda: 0)
        self.peak_used_mb = 0
        self.total_pauses = 0

    @staticmethod
    def sample() -> tuple[int, int] | None:
        """(used_mb, total_mb), or None when nvidia-smi is unavailable."""
        try:
            out = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.used,memory.total",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=15,
            ).stdout.strip().splitlines()[0]
            used, total = (int(x.strip()) for x in out.split(","))
            return used, total
        except Exception:
            return None

    def free_mb(self) -> int | None:
        s = self.sample()
        if s is None:
            return None
        used, total = s
        self.peak_used_mb = max(self.peak_used_mb, used)
        return total - used

    def desktop_used_mb(self) -> int | None:
        """VRAM consumed by everything that is NOT our model, in MiB.

        This is the figure that actually matters, and the reason the naive
        version of this guard was wrong.

        A check on raw free VRAM cannot distinguish "the desktop needs room"
        from "we are holding the room". Once the model is resident it *is* the
        thing consuming the headroom, so a floor check trips, the guard
        unloads, free VRAM jumps, the guard resumes, the model reloads, and the
        floor trips again -- an unload/reload loop that costs ~10-20s and a
        VRAM spike per cycle, and never settles.

        Subtracting our own resident size gives a number that does not move
        when we load or unload, so the decision is stable.
        """
        s = self.sample()
        if s is None:
            return None
        used, total = s
        self.peak_used_mb = max(self.peak_used_mb, used)
        return max(0, used - self._resident_mb())

    def wait_for_headroom(self) -> None:
        """Block until the desktop can spare room for the model, plus the floor.

        The predicate is computed as though the model were loaded, whether or
        not it currently is:

            headroom = total - desktop_used - model_peak_mb

        so it answers "if we hold the model, is there still `floor_mb` left for
        the desktop?" -- which is the question, and which does not oscillate.
        """
        pauses = 0
        while True:
            s = self.sample()
            if s is None:
                return  # no GPU telemetry (CI, non-NVIDIA) -- nothing to guard
            used, total = s
            self.peak_used_mb = max(self.peak_used_mb, used)
            desktop = max(0, used - self._resident_mb())
            headroom = total - desktop - self.model_peak_mb
            if headroom >= self.floor_mb:
                return

            pauses += 1
            self.total_pauses += 1
            if pauses > self.max_consecutive_pauses:
                raise VramExhausted(
                    f"The desktop has been using {desktop}MB of {total}MB for "
                    f"{pauses} checks, leaving {headroom}MB once the model is "
                    f"resident -- under the {self.floor_mb}MB floor. Stopping "
                    "rather than starving it. Progress is checkpointed: close "
                    "some tabs, or lower --gpu-layers, and re-run to continue."
                )
            log.warning(
                "Desktop using %dMB of %dMB; only %dMB would be left with the "
                "model loaded (floor %dMB) - unloading and waiting %ds "
                "[pause %d/%d]",
                desktop, total, headroom, self.floor_mb, self.pause_seconds,
                pauses, self.max_consecutive_pauses,
            )
            self._unload()
            time.sleep(self.pause_seconds)


def model_peak_mb(model: str, gpu_layers: int = -1) -> int:
    """Expected peak VRAM for a model, in MiB, at a given GPU layer count.

    Full-offload figures are measured on this card. Partial offload is
    prorated over llama3.1:8b's 33 layers, which is approximate -- the KV
    cache and compute buffers do not shrink linearly with layers -- so treat
    it as a starting point and then trust what `--calibrate` actually reports.
    """
    full = 3300 if model == LIGHT_MODEL else 6100
    if gpu_layers < 0 or model == LIGHT_MODEL:
        return full
    total_layers = 33
    weights, fixed = full - 900, 900   # ~900MB of KV + compute buffers
    frac = min(gpu_layers, total_layers) / total_layers
    return int(weights * frac) + fixed


def preflight(model: str, floor_mb: int = DEFAULT_FLOOR_MB,
              gpu_layers: int = -1) -> int:
    """Refuse to start a run that cannot fit, and say so before any work.

    Starting and then degrading is the failure mode; this makes an impossible
    run fail in the first second instead of the thirtieth minute.
    """
    s = VramGuard.sample()
    if s is None:
        log.info("No GPU telemetry available - running unguarded.")
        return model_peak_mb(model, gpu_layers)
    used, total = s
    free = total - used
    need = model_peak_mb(model, gpu_layers)

    # Headroom left for the desktop once the model is resident, measured from
    # what is ACTUALLY free right now -- not from `total`. Using total was the
    # first version of this check and it was useless: it ignored the desktop's
    # current usage, which is the whole thing being guarded against. On a clean
    # GPU (575MB used) it waved the 8B model through as leaving 2,051MB, when
    # the real figure was 1,476MB and already under the floor.
    headroom = free - need
    log.info("VRAM: %dMB free of %dMB. %s peaks near %dMB, leaving ~%dMB "
             "for the desktop (floor %dMB).",
             free, total, model, need, headroom, floor_mb)

    if headroom < 0:
        raise VramExhausted(
            f"Only {free}MB VRAM free and {model} peaks near {need}MB. "
            f"Close what is using the GPU, or use {LIGHT_MODEL} instead of "
            f"{HEAVY_MODEL}."
        )
    if headroom < floor_mb:
        log.warning(
            "%s at %s layers would leave only %dMB for the desktop, under the "
            "%dMB floor. Expect pauses. Lower --gpu-layers to trade speed for "
            "headroom, or use %s.",
            model, "all" if gpu_layers < 0 else gpu_layers,
            headroom, floor_mb, LIGHT_MODEL)
    return need
