#!/usr/bin/env python3
"""Long-lived matting worker spawned by server.js (see python-bridge.js).

Reads framed requests on stdin and answers each on stdout (rmbg/protocol.py).
Importing numpy + OpenCV costs a few hundred milliseconds, which is why the
server keeps one process alive instead of spawning one per frame.

Operations:

``ping``
    → ``{ok, version, python, numpy, opencv}``
``refine``  header ``{width, height, options}``, payload = original RGBA + keyed RGBA
    → ``{ok, stats}``, payload = refined RGBA
``key``     header ``{width, height, options, matting}``, payload = original RGBA
    → ``{ok, stats}``, payload = keyed + refined RGBA

Anything printed for humans goes to stderr; stdout carries frames only.
"""

from __future__ import annotations

import os
import platform
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from rmbg import __version__  # noqa: E402
from rmbg.matting import KeyOptions, MattingOptions, refine_matte, remove_background  # noqa: E402
from rmbg.protocol import read_message, write_message  # noqa: E402

MAX_PIXELS = 8192 * 8192


def _dims(header):
    width = int(header.get("width", 0))
    height = int(header.get("height", 0))
    if width <= 0 or height <= 0 or width * height > MAX_PIXELS:
        raise ValueError(f"invalid size {width}x{height}")
    return width, height


def _image(payload, offset, width, height):
    size = width * height * 4
    if len(payload) < offset + size:
        raise ValueError("payload is shorter than width*height*4")
    return np.frombuffer(payload, dtype=np.uint8, count=size, offset=offset).reshape(height, width, 4)


def handle(header, payload):
    op = header.get("op")
    if op == "ping":
        return {
            "ok": True,
            "version": __version__,
            "python": platform.python_version(),
            "numpy": np.__version__,
            "opencv": cv2.__version__,
        }, b""
    if op == "refine":
        width, height = _dims(header)
        original = _image(payload, 0, width, height)
        keyed = _image(payload, width * height * 4, width, height)
        started = time.perf_counter()
        result, stats = refine_matte(original, keyed, MattingOptions.from_dict(header.get("options")))
        stats["ms"] = round((time.perf_counter() - started) * 1000, 1)
        return {"ok": True, "stats": stats}, result.tobytes()
    if op == "key":
        width, height = _dims(header)
        original = _image(payload, 0, width, height)
        started = time.perf_counter()
        result, stats = remove_background(
            original,
            KeyOptions.from_dict(header.get("options")),
            MattingOptions.from_dict(header.get("matting")),
        )
        stats["ms"] = round((time.perf_counter() - started) * 1000, 1)
        return {"ok": True, "stats": stats}, result.tobytes()
    raise ValueError(f"unknown op {op!r}")


def main():
    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer
    # Nothing else may write to the frame channel.
    sys.stdout = sys.stderr
    while True:
        try:
            message = read_message(stdin)
        except Exception as error:  # malformed frame: the stream is unrecoverable
            print(f"[rmbg worker] bad frame: {error}", file=sys.stderr)
            return 1
        if message is None:
            return 0
        header, payload = message
        request_id = header.get("id")
        try:
            response, data = handle(header, payload)
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            response, data = {"ok": False, "error": str(error)}, b""
        response["id"] = request_id
        write_message(stdout, response, data)


if __name__ == "__main__":
    sys.exit(main())
