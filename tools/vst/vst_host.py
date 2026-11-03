"""AudioStage offline plugin host (VST3 / Audio Unit) built on Spotify's `pedalboard` (JUCE).

Runs as a long-lived child process of the Electron app and speaks JSON lines on its own pipe:
  request : {"id": 1, "cmd": "...", ...}
  response: {"id": 1, "ok": true, ...}   or   {"id": 1, "ok": false, "error": "..."}

It runs in a separate process on purpose: a plugin that crashes takes down only this helper.
Audio is exchanged through raw little-endian float32 files laid out as [channels, samples].
"""
import json
import os
import sys
import threading
import traceback

# Plugins sometimes print to stdout, which would corrupt the protocol: keep a private copy of
# the real stdout for protocol messages and point fd 1 at stderr.
_proto = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8")
os.dup2(2, 1)

import numpy as np  # noqa: E402
import pedalboard  # noqa: E402
from pedalboard import VST3Plugin, load_plugin  # noqa: E402

PLUGIN_EXT = (".vst3", ".component", ".vst", ".dll")
HIDDEN_PARAMS = {"buffer_size_frames", "sample_rate_frames"}  # host-provided, not user parameters

state = {"plugin": None, "path": None}


def reply(obj):
    _proto.write(json.dumps(obj, ensure_ascii=False) + "\n")
    _proto.flush()


def resolve_binary(path):
    """On Windows/Linux a .vst3 can be a bundle folder; JUCE needs the binary inside it."""
    if os.path.isdir(path) and path.lower().endswith(".vst3") and sys.platform != "darwin":
        sub = {"win32": ("x86_64-win", ".vst3"), "linux": ("x86_64-linux", ".so")}.get(sys.platform)
        if sub:
            folder = os.path.join(path, "Contents", sub[0])
            if os.path.isdir(folder):
                for f in sorted(os.listdir(folder)):
                    if f.lower().endswith(sub[1]):
                        return os.path.join(folder, f)
    return path


def param_info(key, p):
    def safe(fn, default=None):
        try:
            return fn()
        except Exception:
            return default

    text = safe(lambda: p.string_value)
    if text is None:
        text = safe(lambda: f"{p.value}", "")
    return {
        "key": key,
        "name": safe(lambda: p.name, key),
        "label": safe(lambda: p.label, "") or "",
        "raw": float(safe(lambda: p.raw_value, 0.0)),
        "text": str(text),
        "discrete": bool(safe(lambda: p.is_discrete, False)),
        "boolean": bool(safe(lambda: p.is_boolean, False)),
        "steps": safe(lambda: p.num_steps),
    }


def list_params(plugin):
    return [param_info(k, p) for k, p in plugin.parameters.items() if k not in HIDDEN_PARAMS]


def need_plugin():
    if state["plugin"] is None:
        raise RuntimeError("No plugin is loaded.")
    return state["plugin"]


def run_plugin(plugin, audio, sr, tail_samples):
    """audio: float32 [ch, n]. Returns float32 [ch, n + tail_samples] with plugin latency compensated."""
    ch, n = audio.shape
    latency = int(getattr(plugin, "reported_latency_samples", 0) or 0)
    pad = tail_samples + latency + 64
    padded = np.concatenate([audio, np.zeros((ch, pad), dtype=np.float32)], axis=1) if pad else audio

    def go(x):
        out = plugin(x, sr, reset=True)
        want = n + tail_samples
        if out.shape[1] < want:
            out = np.concatenate([out, np.zeros((out.shape[0], want - out.shape[1]), dtype=np.float32)], axis=1)
        return out[:, :want]

    if ch == 2:
        try:
            return go(padded)
        except Exception:
            pass  # fall through: try per-channel (mono-only plugin)
    outs = []
    for c in range(ch):
        stereo = np.repeat(padded[c : c + 1], 2, axis=0)
        o = go(stereo)
        outs.append(o.mean(axis=0, keepdims=True))
    return np.concatenate(outs, axis=0)


def handle(req):
    cmd = req.get("cmd")
    if cmd == "ping":
        return {"pedalboard": pedalboard.__version__, "python": sys.version.split()[0], "platform": sys.platform}

    if cmd == "load":
        path = req["path"]
        if not path.lower().endswith(PLUGIN_EXT):
            raise ValueError("Not a plugin file (expected .vst3 or .component).")
        binary = resolve_binary(path)
        names = []
        try:
            names = list(VST3Plugin.get_plugin_names_for_file(binary))
        except Exception:
            pass
        name = req.get("pluginName") or (names[0] if names else None)
        plugin = load_plugin(binary, plugin_name=name) if name and len(names) > 1 else load_plugin(binary)
        if getattr(plugin, "is_instrument", False):
            raise RuntimeError("This plugin is an instrument (synth). Only effect plugins can process audio.")
        state["plugin"], state["path"] = plugin, path
        return {
            "name": getattr(plugin, "name", os.path.basename(path)),
            "manufacturer": getattr(plugin, "manufacturer_name", ""),
            "version": getattr(plugin, "version", ""),
            "latency": int(getattr(plugin, "reported_latency_samples", 0) or 0),
            "names": names,
            "params": list_params(plugin),
        }

    if cmd == "params":
        return {"params": list_params(need_plugin())}

    if cmd == "setParam":
        plugin = need_plugin()
        p = plugin.parameters[req["key"]]
        p.raw_value = max(0.0, min(1.0, float(req["raw"])))
        return {"param": param_info(req["key"], p)}

    if cmd == "reset":
        need_plugin().reset()
        return {}

    if cmd == "getState":
        return {"state": need_plugin().raw_state.hex()}

    if cmd == "setState":
        plugin = need_plugin()
        plugin.raw_state = bytes.fromhex(req["state"])
        return {"params": list_params(plugin)}

    if cmd == "editor":
        plugin = need_plugin()
        ev = threading.Event()
        limit = float(req.get("maxSeconds", 0) or 0)
        if limit > 0:  # used by tests to close the window programmatically
            threading.Timer(limit, ev.set).start()
        plugin.show_editor(ev)
        return {"params": list_params(plugin)}

    if cmd == "process":
        plugin = need_plugin()
        ch, n, sr = int(req["ch"]), int(req["n"]), float(req["sr"])
        audio = np.fromfile(req["inPath"], dtype=np.float32).reshape(ch, n)
        out = run_plugin(plugin, audio, sr, int(round(float(req.get("tailSeconds", 0)) * sr)))
        np.ascontiguousarray(out, dtype=np.float32).tofile(req["outPath"])
        return {"ch": int(out.shape[0]), "n": int(out.shape[1])}

    if cmd == "unload":
        state["plugin"], state["path"] = None, None
        return {}

    raise ValueError(f"unknown command {cmd!r}")


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            res = handle(req)
            reply({"id": rid, "ok": True, **res})
        except Exception as e:  # noqa: BLE001 - report everything back to the app
            sys.stderr.write(traceback.format_exc())
            reply({"id": rid, "ok": False, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()
