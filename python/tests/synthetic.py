"""Synthetic chroma-key scenes with known ground truth, shared by the tests."""

import numpy as np
import cv2


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def make_scene(size=160, seed=0):
    """Returns (rgba_uint8 composite, alpha_gt float, fg_gt float HxWx3, key_rgb floats)."""
    rng = np.random.default_rng(seed)
    ss = 4
    big = size * ss
    yy, xx = np.mgrid[0:big, 0:big].astype(np.float32) / ss
    # Disc + an arm + two thin strands (hair-like, sub-pixel wide).
    shape = ((xx - size * 0.45) ** 2 + (yy - size * 0.5) ** 2) < (size * 0.25) ** 2
    shape |= (np.abs(yy - size * 0.5) < size * 0.05) & (xx > size * 0.45) & (xx < size * 0.85)
    for k, x0 in enumerate((0.25, 0.62)):
        line_x = size * x0 + (yy - size * 0.1) * (0.15 + 0.1 * k)
        shape |= (np.abs(xx - line_x) < 0.35) & (yy > size * 0.06) & (yy < size * 0.3)
    alpha = cv2.resize(shape.astype(np.float32), (size, size), interpolation=cv2.INTER_AREA)

    y, x = np.mgrid[0:size, 0:size].astype(np.float32) / size
    fg = np.stack([0.85 - 0.3 * y, 0.45 + 0.2 * x, 0.18 + 0.12 * y], -1)
    # Shadowed, uneven backdrop: the picked key matches only one corner.
    key = np.array([0.0, 36 / 255, 245 / 255], np.float32)
    shade = (0.7 + 0.3 * (1 - x))[..., None]
    bg = np.clip(key[None, None, :] * shade + np.array([0.06, 0.08, 0.0]) * y[..., None], 0, 1)
    img = alpha[..., None] * fg + (1 - alpha[..., None]) * bg
    img = np.clip(img + rng.normal(0, 0.006, img.shape), 0, 1)
    rgba = np.dstack([np.round(img * 255), np.full((size, size), 255)]).astype(np.uint8)
    return rgba, alpha, fg.astype(np.float32), key


def naive_key(rgba, key, tol=0.12, soft=0.18):
    """A browser-keyer stand-in: RGB distance to the single picked key, smoothstep, hard despill."""
    rgb = rgba[..., :3].astype(np.float32) / 255
    d = np.sqrt(((rgb - key) ** 2).sum(-1))
    a = smoothstep(tol, tol + soft, d)
    out = rgba.copy()
    lim = np.maximum(rgb[..., 0], rgb[..., 1])
    rgb2 = rgb.copy()
    rgb2[..., 2] = np.minimum(rgb[..., 2], lim)
    out[..., :3] = np.round(rgb2 * 255).astype(np.uint8)
    out[..., 3] = np.round(a * 255).astype(np.uint8)
    return out
