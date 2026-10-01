"""Precision matting for chroma-key video frames and sprite sheets.

The browser keyer decides *what* is background from colour distance alone, one
pixel at a time. That is fast and it is the right tool for the decision, but it
is a poor estimator of the two things an edge actually needs:

* **Alpha.** A mixed edge pixel is ``I = a*F + (1-a)*B``. Distance-to-key turns
  into alpha through a fixed smoothstep, so the same 50 % mix comes out at a
  different alpha depending on how far the subject colour happens to sit from
  the key, and on a gradient backdrop the key colour is simply wrong away from
  where it was picked.
* **Colour.** Despill clamps the key channel, which removes the cast but also
  shifts the hue of every legitimately blue-ish pixel along the rim.

This module keeps the browser's decision and re-estimates only the uncertain
band around it:

1. A trimap from the coarse matte: sure foreground, sure background, and an
   ``band``-pixel unknown strip around every edge.
2. *Local* background and foreground plates, pushed into the strip from the
   nearby sure pixels (pyramid push-pull). The backdrop colour at an edge pixel
   is the colour of the backdrop *right next to it*, so gradients, vignetting
   and shadows stop biasing alpha.
3. Alpha by projecting ``I - B`` onto ``F - B`` — the closed-form solution of
   the compositing equation for one pixel — falling back to the coarse alpha
   where foreground and background are too similar to tell apart.
4. An edge-aware colour guided filter over the strip, so alpha follows the
   image's own edges instead of the noise of a per-pixel estimate.
5. Foreground colour by un-mixing the compositing equation with the local
   background (``F = (I - (1-a)B) / a``), then a gentle despill on the strip
   only. Sure-foreground pixels keep the browser keyer's colour byte for byte.

Optional cleanups (off by default) drop small foreground specks and fill small
enclosed holes.

Pure numpy + OpenCV; no network, no model downloads.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

__all__ = [
    "MattingOptions",
    "KeyOptions",
    "parse_color",
    "detect_key_colors",
    "key_distance",
    "coarse_alpha",
    "refine_matte",
    "remove_background",
    "guided_filter_color",
    "fill_plate",
]

EPS = 1e-6


# --------------------------------------------------------------------------- #
# Options
# --------------------------------------------------------------------------- #


def _clamp(value, lo, hi, default):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if not np.isfinite(number):
        return default
    return min(hi, max(lo, number))


@dataclass
class MattingOptions:
    """Options of the refinement pass. Every field is clamped on construction."""

    band: int = 4  # unknown strip half-width, px
    smooth: float = 0.5  # 0 = raw per-pixel estimate, 1 = strongest guided filter
    spill: float = 0.6  # despill strength on the strip
    decontaminate: bool = True  # un-mix rim colours from the local backdrop
    min_island: int = 0  # drop foreground blobs smaller than this, px (0 = off)
    max_hole: int = 0  # fill enclosed holes smaller than this, px (0 = off)
    key_colors: list = field(default_factory=list)  # [(r, g, b) floats 0..1]

    @classmethod
    def from_dict(cls, data: dict | None) -> "MattingOptions":
        data = data or {}
        keys = [parse_color(c) for c in data.get("keyColors", []) or []]
        return cls(
            band=int(round(_clamp(data.get("band"), 1, 16, 4))),
            smooth=_clamp(data.get("smooth"), 0, 1, 0.5),
            spill=_clamp(data.get("spill"), 0, 1, 0.6),
            decontaminate=bool(data.get("decontaminate", True)),
            min_island=int(round(_clamp(data.get("minIsland"), 0, 1_000_000, 0))),
            max_hole=int(round(_clamp(data.get("maxHole"), 0, 1_000_000, 0))),
            key_colors=[k for k in keys if k is not None],
        )


@dataclass
class KeyOptions:
    """Options of the standalone keyer (CLI / ``op: key``)."""

    key_colors: list = field(default_factory=list)
    tolerance: float = 0.10  # distance below which a pixel is backdrop
    softness: float = 0.08  # distance over which alpha ramps to opaque
    luma_weight: float = 0.35  # how much brightness counts (shadows keep the key's hue)
    connected: bool = False  # only backdrop reachable from the border is removed
    auto_colors: int = 2  # border clusters to detect when no colour is given

    @classmethod
    def from_dict(cls, data: dict | None) -> "KeyOptions":
        data = data or {}
        keys = [parse_color(c) for c in data.get("keyColors", []) or []]
        return cls(
            key_colors=[k for k in keys if k is not None],
            tolerance=_clamp(data.get("tolerance"), 0, 1, 0.10),
            softness=_clamp(data.get("softness"), 0.001, 1, 0.08),
            luma_weight=_clamp(data.get("lumaWeight"), 0, 1, 0.35),
            connected=bool(data.get("connected", False)),
            auto_colors=int(round(_clamp(data.get("autoColors"), 1, 4, 2))),
        )


def parse_color(value):
    """``'#0024F5'``, ``'0024f5'``, ``{'r':0,'g':36,'b':245}`` or ``[0,36,245]`` → floats 0..1."""
    if value is None:
        return None
    if isinstance(value, dict):
        if "hex" in value and not all(k in value for k in "rgb"):
            return parse_color(value["hex"])
        try:
            rgb = [float(value[k]) for k in "rgb"]
        except (KeyError, TypeError, ValueError):
            return None
        return tuple(min(1.0, max(0.0, c / 255.0)) for c in rgb)
    if isinstance(value, (list, tuple)) and len(value) >= 3:
        try:
            rgb = [float(c) for c in value[:3]]
        except (TypeError, ValueError):
            return None
        scale = 255.0 if max(rgb) > 1.0 else 1.0
        return tuple(min(1.0, max(0.0, c / scale)) for c in rgb)
    text = str(value).strip().lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    if len(text) != 6:
        return None
    try:
        return tuple(int(text[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    except ValueError:
        return None


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #


def _smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / max(edge1 - edge0, EPS), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _ycc(rgb):
    """BT.601 luma + scaled colour differences; chroma ranges roughly ±0.5."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    return np.stack([y, 0.564 * (b - y), 0.713 * (r - y)], axis=-1)


def _disk(radius):
    size = 2 * int(radius) + 1
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))


def _erode(mask, radius):
    if radius <= 0:
        return mask
    return cv2.erode(mask.astype(np.uint8), _disk(radius), borderType=cv2.BORDER_REPLICATE).astype(bool)


def _dilate(mask, radius):
    if radius <= 0:
        return mask
    return cv2.dilate(mask.astype(np.uint8), _disk(radius), borderType=cv2.BORDER_REPLICATE).astype(bool)


def _box(x, radius):
    k = 2 * radius + 1
    return cv2.boxFilter(x, -1, (k, k), normalize=True, borderType=cv2.BORDER_REFLECT)


# --------------------------------------------------------------------------- #
# Plates and filters
# --------------------------------------------------------------------------- #


def fill_plate(values, weights):
    """Push-pull interpolation: fill every pixel from nearby pixels where ``weights`` > 0.

    ``values`` is HxWxC float32, ``weights`` HxW float32 in 0..1. A pixel with
    weight 1 keeps its own value exactly; a pixel with weight 0 takes the
    Gaussian-weighted mean of the nearest weighted pixels at whichever pyramid
    level first has any. The result is smooth, local, and O(N).
    """
    weights = weights.astype(np.float32)
    values = values.astype(np.float32)
    nums = [values * weights[..., None]]
    dens = [weights]
    while min(dens[-1].shape[:2]) > 2 and len(dens) < 14:
        nums.append(cv2.pyrDown(nums[-1]))
        dens.append(cv2.pyrDown(dens[-1]))
        if nums[-1].ndim == 2:  # pyrDown drops a singleton channel axis
            nums[-1] = nums[-1][..., None]

    den = dens[-1][..., None]
    estimate = np.where(den > EPS, nums[-1] / np.maximum(den, EPS), 0.0).astype(np.float32)
    if not np.any(dens[-1] > EPS):
        return estimate if len(nums) == 1 else np.zeros_like(values)
    # Coarsest level: spread its own weighted mean over any empty cells.
    if np.any(dens[-1] <= EPS):
        mean = nums[-1].reshape(-1, nums[-1].shape[-1]).sum(0) / max(float(dens[-1].sum()), EPS)
        estimate = np.where(den > EPS, estimate, mean[None, None, :]).astype(np.float32)

    for level in range(len(nums) - 2, -1, -1):
        h, w = dens[level].shape[:2]
        up = cv2.pyrUp(estimate, dstsize=(w, h))
        if up.ndim == 2:
            up = up[..., None]
        d = np.clip(dens[level], 0.0, 1.0)[..., None]
        # nums = d * local_mean, so this is d*local + (1-d)*coarser.
        estimate = (nums[level] + (1.0 - d) * up).astype(np.float32)
    return estimate


def guided_filter_color(guide, src, radius, eps):
    """He et al. guided filter with a 3-channel guide. ``guide`` HxWx3, ``src`` HxW.

    Runs in float64: on a grey guide (r = g = b) the covariance matrix is rank
    one plus ``eps``, and float32 cancellation in its cofactors is larger than
    ``eps`` itself, which turns a flat edge into ringing.
    """
    guide = guide.astype(np.float64)
    src = src.astype(np.float64)
    r = max(1, int(radius))
    mean_i = _box(guide, r)
    mean_p = _box(src, r)
    mean_ip = _box(guide * src[..., None], r)
    cov_ip = mean_ip - mean_i * mean_p[..., None]

    ir, ig, ib = guide[..., 0], guide[..., 1], guide[..., 2]
    mr, mg, mb = mean_i[..., 0], mean_i[..., 1], mean_i[..., 2]
    vrr = _box(ir * ir, r) - mr * mr + eps
    vrg = _box(ir * ig, r) - mr * mg
    vrb = _box(ir * ib, r) - mr * mb
    vgg = _box(ig * ig, r) - mg * mg + eps
    vgb = _box(ig * ib, r) - mg * mb
    vbb = _box(ib * ib, r) - mb * mb + eps

    # Symmetric 3x3 inverse by cofactors, vectorised over every pixel.
    c_rr = vgg * vbb - vgb * vgb
    c_rg = vgb * vrb - vrg * vbb
    c_rb = vrg * vgb - vgg * vrb
    c_gg = vrr * vbb - vrb * vrb
    c_gb = vrb * vrg - vrr * vgb
    c_bb = vrr * vgg - vrg * vrg
    det = vrr * c_rr + vrg * c_rg + vrb * c_rb
    det = np.where(np.abs(det) < 1e-30, 1e-30, det)

    cr, cg, cb = cov_ip[..., 0], cov_ip[..., 1], cov_ip[..., 2]
    a_r = (c_rr * cr + c_rg * cg + c_rb * cb) / det
    a_g = (c_rg * cr + c_gg * cg + c_gb * cb) / det
    a_b = (c_rb * cr + c_gb * cg + c_bb * cb) / det
    b = mean_p - a_r * mr - a_g * mg - a_b * mb

    a = np.stack([a_r, a_g, a_b], axis=-1)
    mean_a = _box(a, r)
    mean_b = _box(b, r)
    return ((mean_a * guide).sum(-1) + mean_b).astype(np.float32)


# --------------------------------------------------------------------------- #
# Standalone keyer (CLI, op: key)
# --------------------------------------------------------------------------- #


def detect_key_colors(rgb, count=2, border=3):
    """Dominant colours of the image border (k-means), most common first."""
    h, w = rgb.shape[:2]
    b = max(1, min(border, h // 4 or 1, w // 4 or 1))
    strip = np.concatenate(
        [
            rgb[:b].reshape(-1, 3),
            rgb[-b:].reshape(-1, 3),
            rgb[:, :b].reshape(-1, 3),
            rgb[:, -b:].reshape(-1, 3),
        ]
    ).astype(np.float32)
    if len(strip) > 20000:
        strip = strip[np.linspace(0, len(strip) - 1, 20000).astype(int)]
    k = max(1, min(int(count), len(strip)))
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 1e-4)
    _, labels, centers = cv2.kmeans(strip, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    shares = np.bincount(labels.ravel(), minlength=k) / len(labels)
    order = np.argsort(-shares)
    # A cluster that is a sliver of the border is a subject touching the edge,
    # not backdrop. Always keep the largest one.
    keep = [i for i in order if shares[i] >= 0.15] or [order[0]]
    return [tuple(float(c) for c in centers[i]) for i in keep]


def key_distance(rgb, key_colors, luma_weight=0.35):
    """Minimum YCbCr distance (luma down-weighted) from every pixel to any key colour."""
    ycc = _ycc(rgb)
    w = np.array([luma_weight, 1.0, 1.0], dtype=np.float32)
    best = np.full(rgb.shape[:2], np.inf, dtype=np.float32)
    for color in key_colors:
        k = _ycc(np.asarray(color, dtype=np.float32)[None, None, :])
        d = np.sqrt((((ycc - k) * w) ** 2).sum(-1))
        np.minimum(best, d, out=best)
    return best


def coarse_alpha(rgb, options: KeyOptions):
    """Smoothstep matte from key distance; optionally keep only border-connected backdrop."""
    keys = options.key_colors or detect_key_colors(rgb, options.auto_colors)
    dist = key_distance(rgb, keys, options.luma_weight)
    alpha = _smoothstep(options.tolerance, options.tolerance + options.softness, dist)
    if options.connected:
        candidate = (alpha < 0.999).astype(np.uint8)
        _, labels = cv2.connectedComponents(candidate, connectivity=8)
        border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
        border = border[border > 0]
        reachable = np.isin(labels, border)
        alpha = np.where(reachable, alpha, 1.0)
    return alpha.astype(np.float32), keys


# --------------------------------------------------------------------------- #
# Refinement
# --------------------------------------------------------------------------- #


def _despill(rgb, key_colors, amount):
    """Pull the key's dominant channel down to the other two, by ``amount``."""
    if amount <= 0 or not key_colors:
        return rgb
    key = np.asarray(key_colors[0], dtype=np.float32)
    channel = int(np.argmax(key))
    others = [c for c in range(3) if c != channel]
    # A grey or muddy key has no dominant channel to suppress.
    if key[channel] - key[others].max() < 0.12:
        return rgb
    out = rgb.copy()
    limit = np.maximum(rgb[..., others[0]], rgb[..., others[1]])
    excess = np.maximum(0.0, rgb[..., channel] - limit)
    out[..., channel] = rgb[..., channel] - amount * excess
    return out


def _cleanup(alpha, min_island, max_hole):
    """Drop small opaque specks and fill small enclosed holes. Returns (alpha, filled_mask)."""
    filled = np.zeros(alpha.shape, dtype=bool)
    if min_island > 0:
        solid = (alpha >= 0.5).astype(np.uint8)
        n, labels, stats, _ = cv2.connectedComponentsWithStats(solid, connectivity=8)
        small = np.zeros(n, dtype=bool)
        small[1:] = stats[1:, cv2.CC_STAT_AREA] < min_island
        if small.any():
            specks = small[labels]
            # Take the speck's own soft fringe with it, but never eat into a big blob.
            fringe = _dilate(specks, 1) & ~((~small[labels]) & (labels > 0))
            alpha = np.where(fringe, 0.0, alpha)
    if max_hole > 0:
        clear = (alpha < 0.5).astype(np.uint8)
        n, labels, stats, _ = cv2.connectedComponentsWithStats(clear, connectivity=4)
        border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
        fill = np.zeros(n, dtype=bool)
        fill[1:] = stats[1:, cv2.CC_STAT_AREA] < max_hole
        fill[border] = False
        fill[0] = False
        if fill.any():
            filled = fill[labels]
            alpha = np.where(filled, 1.0, alpha)
    return alpha, filled


def refine_matte(original_rgba, keyed_rgba, options: MattingOptions):
    """Re-estimate alpha and rim colour of ``keyed_rgba`` from ``original_rgba``.

    Both are HxWx4 uint8. Returns ``(rgba_uint8, stats)``. Pixels outside the
    unknown strip keep the keyed input exactly (unless a cleanup touched them).
    """
    original_rgba = np.ascontiguousarray(original_rgba, dtype=np.uint8)
    keyed_rgba = np.ascontiguousarray(keyed_rgba, dtype=np.uint8)
    if original_rgba.shape != keyed_rgba.shape or original_rgba.ndim != 3 or original_rgba.shape[2] != 4:
        raise ValueError("original and keyed must both be HxWx4")

    out = keyed_rgba.copy()
    h, w = keyed_rgba.shape[:2]
    stats = {"bandPixels": 0, "changedPixels": 0, "islandPixels": 0, "holePixels": 0, "skipped": None}

    a0 = keyed_rgba[..., 3].astype(np.float32) / 255.0
    # The source's own alpha caps everything: a transparent source pixel stays transparent.
    source_alpha = original_rgba[..., 3].astype(np.float32) / 255.0
    band = options.band
    sure_fg = _erode(a0 >= 0.985, band)
    sure_bg = _erode(a0 <= 0.015, band)
    unknown = ~(sure_fg | sure_bg)

    if not sure_bg.any():
        stats["skipped"] = "no-background"
    elif not sure_fg.any():
        stats["skipped"] = "no-foreground"
    elif not unknown.any():
        stats["skipped"] = "no-edges"

    alpha = a0.copy()
    rgb_out = keyed_rgba[..., :3].astype(np.float32) / 255.0

    if stats["skipped"] is None:
        # Work inside the bounding box of the strip, padded so the plates have
        # sure pixels of both kinds to pull from.
        ys, xs = np.nonzero(unknown)
        pad = max(48, 6 * band)
        y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + pad + 1)
        x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + pad + 1)
        crop = (slice(y0, y1), slice(x0, x1))

        image = original_rgba[crop][..., :3].astype(np.float32) / 255.0
        u = unknown[crop]
        fg_w = sure_fg[crop].astype(np.float32)
        bg_w = sure_bg[crop].astype(np.float32)
        if not bg_w.any() or not fg_w.any():
            # The pad did not reach any sure pixel of one kind; use the whole frame.
            y0, y1, x0, x1 = 0, h, 0, w
            crop = (slice(0, h), slice(0, w))
            image = original_rgba[..., :3].astype(np.float32) / 255.0
            u = unknown
            fg_w = sure_fg.astype(np.float32)
            bg_w = sure_bg.astype(np.float32)

        back = fill_plate(image, bg_w)
        fore = fill_plate(image, fg_w)

        # Closed-form alpha for one pixel given its local F and B.
        diff = fore - back
        norm2 = (diff * diff).sum(-1)
        a_proj = np.clip(((image - back) * diff).sum(-1) / np.maximum(norm2, EPS), 0.0, 1.0)
        # Where F and B are nearly the same colour the projection is noise;
        # lean on the keyer's own decision there.
        confidence = _smoothstep(0.035, 0.12, np.sqrt(norm2))
        a_coarse = a0[crop]
        a_est = confidence * a_proj + (1.0 - confidence) * a_coarse

        # Edge-aware smoothing. Small eps keeps hard edges hard; the slider
        # widens the window and relaxes eps.
        radius = 1 + int(round(options.smooth * 3))
        eps = 1e-5 + options.smooth * 4e-3
        if options.smooth > 0:
            constrained = np.where(fg_w > 0, 1.0, np.where(bg_w > 0, 0.0, a_est)).astype(np.float32)
            a_gf = np.clip(guided_filter_color(image, constrained, radius, eps), 0.0, 1.0)
            a_est = np.where(u, a_gf, a_est)

        # Snap the almost-certain ends so a refined edge does not leave a haze
        # of 1/255 alphas around the subject.
        a_est = np.where(a_est < 0.02, 0.0, np.where(a_est > 0.985, 1.0, a_est))
        a_new = np.where(u, a_est, a_coarse)
        alpha[crop] = a_new

        if options.decontaminate:
            safe = np.maximum(a_new, 0.05)[..., None]
            unmixed = np.clip((image - (1.0 - a_new[..., None]) * back) / safe, 0.0, 1.0)
            # Thin alpha cannot carry its own colour reliably; hand those pixels
            # the interior colour instead.
            trust = _smoothstep(0.05, 0.45, a_new)[..., None]
            rim = trust * unmixed + (1.0 - trust) * fore
        else:
            rim = image
        rim = _despill(rim, options.key_colors, options.spill)
        region = rgb_out[crop]
        region[u] = rim[u]
        rgb_out[crop] = region
        stats["bandPixels"] = int(u.sum())

    alpha, filled = _cleanup(alpha, options.min_island, options.max_hole)
    if filled.any():
        source_rgb = original_rgba[..., :3].astype(np.float32) / 255.0
        rgb_out[filled] = _despill(source_rgb, options.key_colors, options.spill)[filled]
        stats["holePixels"] = int(filled.sum())
    if options.min_island > 0:
        stats["islandPixels"] = int(((a0 >= 0.5) & (alpha < 0.5)).sum())

    alpha = np.minimum(alpha, source_alpha)
    out[..., 3] = np.clip(np.round(alpha * 255.0), 0, 255).astype(np.uint8)
    touched = unknown | filled | (alpha != a0)
    rgb_bytes = np.clip(np.round(rgb_out * 255.0), 0, 255).astype(np.uint8)
    # Pixels nobody touched are the keyed input, byte for byte.
    out[..., :3] = np.where(touched[..., None], rgb_bytes, keyed_rgba[..., :3])
    stats["changedPixels"] = int(np.any(out != keyed_rgba, axis=-1).sum())
    return out, stats


def remove_background(rgba, key_options: KeyOptions, matting: MattingOptions | None = None):
    """Standalone pipeline: coarse key from colour distance, then ``refine_matte``."""
    rgba = np.ascontiguousarray(rgba, dtype=np.uint8)
    if rgba.ndim != 3 or rgba.shape[2] not in (3, 4):
        raise ValueError("expected HxWx3 or HxWx4 uint8")
    if rgba.shape[2] == 3:
        rgba = np.dstack([rgba, np.full(rgba.shape[:2], 255, np.uint8)])
    rgb = rgba[..., :3].astype(np.float32) / 255.0
    alpha, keys = coarse_alpha(rgb, key_options)

    coarse = rgba.copy()
    coarse[..., 3] = np.round(np.minimum(alpha, rgba[..., 3] / 255.0) * 255.0).astype(np.uint8)
    matting = matting or MattingOptions()
    if not matting.key_colors:
        matting.key_colors = list(keys)
    # The coarse pass did no despill, so the interior gets the same light touch
    # the strip does; a cast on opaque pixels is the backdrop's reflection.
    if matting.spill > 0:
        interior = _despill(rgb, keys, matting.spill * 0.5)
        coarse[..., :3] = np.clip(np.round(interior * 255.0), 0, 255).astype(np.uint8)
    result, stats = refine_matte(rgba, coarse, matting)
    stats["keyColors"] = ["#%02x%02x%02x" % tuple(int(round(c * 255)) for c in k) for k in keys]
    return result, stats
