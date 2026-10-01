#!/usr/bin/env python3
"""Remove a chroma-key background from images, folders of images, or a video.

Runs the same precision-matting engine the web app uses (rmbg/matting.py),
without the browser.

Examples::

    # One image, backdrop colour detected from the border
    python3 python/remove_bg.py sprite.png -o sprite_clean.png

    # A whole folder, explicit key colours, only border-connected backdrop
    python3 python/remove_bg.py frames/ -o clean/ --key "#0024F5" --key "#1a3cff" --connected

    # 24 frames evenly spread over 1.0–2.5 s of a video, packed 6 per row
    python3 python/remove_bg.py clip.mp4 -o out/ --start 1 --end 2.5 --frames 24 --sheet 6
"""

from __future__ import annotations

import argparse
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from rmbg.matting import KeyOptions, MattingOptions, parse_color, remove_background  # noqa: E402

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
VIDEO_EXT = {".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".ogv", ".flv"}


def read_rgba(path: Path) -> np.ndarray:
    data = np.fromfile(str(path), dtype=np.uint8)  # handles non-ASCII paths
    image = cv2.imdecode(data, cv2.IMREAD_UNCHANGED)
    if image is None:
        raise ValueError(f"cannot read image {path}")
    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGRA)
    elif image.shape[2] == 3:
        image = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
    if image.dtype != np.uint8:
        image = (image / 257).astype(np.uint8)
    return cv2.cvtColor(image, cv2.COLOR_BGRA2RGBA)


def write_png(path: Path, rgba: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ok, encoded = cv2.imencode(".png", cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
    if not ok:
        raise ValueError(f"cannot encode {path}")
    encoded.tofile(str(path))


def build_options(args):
    keys = []
    for value in args.key or []:
        color = parse_color(value)
        if color is None:
            raise SystemExit(f"invalid --key colour: {value!r}")
        keys.append(color)
    key_options = KeyOptions(
        key_colors=keys,
        tolerance=args.tolerance,
        softness=max(0.001, args.softness),
        luma_weight=args.luma_weight,
        connected=args.connected,
        auto_colors=args.auto_colors,
    )
    matting = MattingOptions(
        band=args.band,
        smooth=args.smooth,
        spill=args.spill,
        decontaminate=not args.no_decontaminate,
        min_island=args.min_island,
        max_hole=args.max_hole,
        key_colors=list(keys),
    )
    return key_options, matting


def process(rgba, args):
    key_options, matting = build_options(args)
    return remove_background(rgba, key_options, matting)


def video_frames(path: Path, start: float, end: float | None, count: int):
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise ValueError(f"cannot open video {path}")
    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = total / fps if total else None
    stop = min(end, duration) if (end is not None and duration) else (end or duration)
    if stop is None:
        raise ValueError("cannot determine video duration; pass --end")
    first = int(math.floor(start * fps))
    last = max(first, int(math.ceil(stop * fps)) - 1)
    span = last - first + 1
    count = max(1, min(count, span))
    # Mid-frame indices spread evenly, like the app's planLoopFrames().
    indices = [first + min(span - 1, int(round(i * span / count))) for i in range(count)]
    for index in indices:
        capture.set(cv2.CAP_PROP_POS_FRAMES, index)
        ok, frame = capture.read()
        if not ok:
            break
        yield index, cv2.cvtColor(frame, cv2.COLOR_BGR2RGBA)
    capture.release()


def pack_sheet(frames, cols):
    h, w = frames[0].shape[:2]
    rows = math.ceil(len(frames) / cols)
    sheet = np.zeros((rows * h, cols * w, 4), dtype=np.uint8)
    for i, frame in enumerate(frames):
        r, c = divmod(i, cols)
        sheet[r * h : (r + 1) * h, c * w : (c + 1) * w] = frame
    return sheet


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", type=Path, help="image, folder of images, or video")
    parser.add_argument("-o", "--output", type=Path, help="output file (single image) or folder")
    key = parser.add_argument_group("keying")
    key.add_argument("--key", action="append", help="backdrop colour, e.g. '#0024F5' (repeatable; default: detect from border)")
    key.add_argument("--tolerance", type=float, default=0.10, help="distance treated as backdrop (0–1, default 0.10)")
    key.add_argument("--softness", type=float, default=0.08, help="distance over which alpha ramps up (default 0.08)")
    key.add_argument("--luma-weight", type=float, default=0.35, help="weight of brightness vs. hue (default 0.35)")
    key.add_argument("--connected", action="store_true", help="only remove backdrop connected to the image border")
    key.add_argument("--auto-colors", type=int, default=2, help="border colours to detect when no --key (1–4)")
    refine = parser.add_argument_group("refinement")
    refine.add_argument("--band", type=int, default=4, help="edge band width to re-estimate, px (default 4)")
    refine.add_argument("--smooth", type=float, default=0.5, help="edge-aware smoothing 0–1 (default 0.5)")
    refine.add_argument("--spill", type=float, default=0.6, help="despill strength 0–1 (default 0.6)")
    refine.add_argument("--no-decontaminate", action="store_true", help="keep source colours on the rim")
    refine.add_argument("--min-island", type=int, default=0, help="drop opaque specks smaller than N px")
    refine.add_argument("--max-hole", type=int, default=0, help="fill enclosed holes smaller than N px")
    video = parser.add_argument_group("video")
    video.add_argument("--start", type=float, default=0.0, help="start time, s")
    video.add_argument("--end", type=float, default=None, help="end time, s (default: end of video)")
    video.add_argument("--frames", type=int, default=24, help="frames to extract (default 24)")
    video.add_argument("--sheet", type=int, default=0, metavar="COLS", help="also pack frames into a sprite sheet with COLS columns")
    args = parser.parse_args(argv)

    source = args.input
    if not source.exists():
        parser.error(f"{source} does not exist")

    suffix = source.suffix.lower()
    if source.is_file() and suffix in IMAGE_EXT:
        output = args.output or source.with_name(f"{source.stem}_nobg.png")
        if output.is_dir():
            output = output / f"{source.stem}.png"
        result, stats = process(read_rgba(source), args)
        write_png(output, result)
        print(f"{source} → {output}  (key {', '.join(stats['keyColors'])}, edge band {stats['bandPixels']} px)")
        return 0

    if source.is_dir():
        output = args.output or source.with_name(f"{source.name}_nobg")
        files = sorted(p for p in source.iterdir() if p.suffix.lower() in IMAGE_EXT)
        if not files:
            parser.error(f"no images in {source}")
        processed = []
        for path in files:
            result, _ = process(read_rgba(path), args)
            write_png(output / f"{path.stem}.png", result)
            processed.append(result)
            print(f"{path.name} ✓")
        if args.sheet and len({r.shape for r in processed}) == 1:
            write_png(output / "sprite_sheet.png", pack_sheet(processed, args.sheet))
        print(f"{len(files)} image(s) → {output}")
        return 0

    if source.is_file() and suffix in VIDEO_EXT:
        output = args.output or source.with_name(f"{source.stem}_frames")
        frames = []
        for n, (index, rgba) in enumerate(video_frames(source, args.start, args.end, args.frames)):
            result, _ = process(rgba, args)
            write_png(output / f"frame_{n:03d}.png", result)
            frames.append(result)
            print(f"frame {n + 1}/{args.frames} (source #{index}) ✓")
        if not frames:
            parser.error("no frames decoded")
        if args.sheet:
            write_png(output / "sprite_sheet.png", pack_sheet(frames, args.sheet))
        print(f"{len(frames)} frame(s) → {output}")
        return 0

    parser.error(f"unsupported input {source}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
