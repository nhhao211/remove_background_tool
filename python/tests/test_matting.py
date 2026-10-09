"""Run with: python3 -m unittest discover -s python/tests"""

import io
import os
import struct
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path[:0] = [ROOT, HERE]

import numpy as np  # noqa: E402

from rmbg.matting import (  # noqa: E402
    KeyOptions,
    MattingOptions,
    detect_key_colors,
    _guided_filter_where,
    fill_plate,
    guided_filter_color,
    parse_color,
    refine_matte,
    remove_background,
)
from rmbg.protocol import decode_body, encode_body, read_message, write_message  # noqa: E402
from synthetic import make_scene, naive_key  # noqa: E402


def edge_band(alpha_gt, radius=3):
    import cv2

    edge = ((alpha_gt > 0.01) & (alpha_gt < 0.99)).astype(np.uint8)
    return cv2.dilate(edge, np.ones((2 * radius + 1,) * 2, np.uint8)).astype(bool)


class ParseColorTest(unittest.TestCase):
    def test_formats(self):
        self.assertEqual(parse_color("#0024F5"), (0.0, 36 / 255, 245 / 255))
        self.assertEqual(parse_color("fff"), (1.0, 1.0, 1.0))
        self.assertEqual(parse_color({"r": 255, "g": 0, "b": 0, "hex": "#ff0000"}), (1.0, 0.0, 0.0))
        self.assertEqual(parse_color({"hex": "#00ff00"}), (0.0, 1.0, 0.0))
        self.assertEqual(parse_color([0, 0, 255]), (0.0, 0.0, 1.0))
        self.assertIsNone(parse_color("nope"))
        self.assertIsNone(parse_color(None))

    def test_options_clamp_garbage(self):
        options = MattingOptions.from_dict({"band": "abc", "smooth": 9, "spill": float("nan"), "keyColors": ["#00f", "zzz"]})
        self.assertEqual(options.band, 4)
        self.assertEqual(options.smooth, 1)
        self.assertEqual(options.spill, 0.6)
        self.assertEqual(len(options.key_colors), 1)


class FilterTest(unittest.TestCase):
    def test_fill_plate_keeps_weighted_pixels_and_fills_the_rest(self):
        values = np.zeros((32, 32, 3), np.float32)
        values[:, :16] = (0.1, 0.2, 0.9)
        weights = np.zeros((32, 32), np.float32)
        weights[:, :16] = 1
        plate = fill_plate(values, weights)
        np.testing.assert_allclose(plate[:, :16], values[:, :16], atol=1e-5)
        np.testing.assert_allclose(plate[:, 16:], np.broadcast_to((0.1, 0.2, 0.9), (32, 16, 3)), atol=1e-3)

    def test_guided_filter_preserves_constant_and_edges(self):
        guide = np.zeros((40, 40, 3), np.float32)
        guide[:, 20:] = 1.0
        src = (guide[..., 0] > 0.5).astype(np.float32)
        out = guided_filter_color(guide, src, 2, 1e-5)
        self.assertLess(np.abs(out - src).max(), 0.02)

    def test_fill_plate_at_matches_the_full_plate(self):
        rng = np.random.default_rng(3)
        values = rng.random((90, 70, 3), dtype=np.float32)
        weights = (rng.random((90, 70)) > 0.7).astype(np.float32)
        at = np.nonzero(weights == 0)
        np.testing.assert_allclose(fill_plate(values, weights, at=at), fill_plate(values, weights)[at], atol=1e-6)

    def test_tiled_guided_filter_matches_the_whole_image(self):
        rng = np.random.default_rng(4)
        guide = rng.random((300, 260, 3), dtype=np.float32)
        src = rng.random((300, 260), dtype=np.float32)
        mask = np.zeros((300, 260), bool)
        mask[5:40, 250:258] = True  # touches the image border
        mask[150:152, 100:230] = True  # spans tiles
        full = guided_filter_color(guide, src, 3, 1e-4)
        tiled = _guided_filter_where(guide, src, mask, 3, 1e-4, tile=64)
        np.testing.assert_allclose(tiled[mask], full[mask], atol=1e-5)
        far = np.zeros_like(mask)
        far[260:, :60] = True  # no tile there is occupied
        np.testing.assert_array_equal(tiled[far], src[far])


class RefineTest(unittest.TestCase):
    def setUp(self):
        self.rgba, self.alpha_gt, self.fg_gt, self.key = make_scene(160)
        self.coarse = naive_key(self.rgba, self.key)
        self.band = edge_band(self.alpha_gt)

    def test_alpha_and_rim_colour_beat_the_coarse_key(self):
        out, stats = refine_matte(self.rgba, self.coarse, MattingOptions(key_colors=[tuple(self.key)]))
        before = np.abs(self.coarse[..., 3] / 255 - self.alpha_gt)[self.band].mean()
        after = np.abs(out[..., 3] / 255 - self.alpha_gt)[self.band].mean()
        self.assertLess(after, before * 0.4, (before, after))

        rim = self.band & (self.alpha_gt > 0.3)
        colour_before = np.abs(self.coarse[..., :3] / 255 - self.fg_gt)[rim].mean()
        colour_after = np.abs(out[..., :3] / 255 - self.fg_gt)[rim].mean()
        self.assertLess(colour_after, colour_before * 0.6, (colour_before, colour_after))
        self.assertGreater(stats["bandPixels"], 0)

    def test_sure_pixels_are_untouched_byte_for_byte(self):
        import cv2

        out, _ = refine_matte(self.rgba, self.coarse, MattingOptions(band=3, key_colors=[tuple(self.key)]))
        a0 = self.coarse[..., 3]
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        sure = cv2.erode((a0 >= 252).astype(np.uint8), kernel).astype(bool)
        sure |= cv2.erode((a0 <= 3).astype(np.uint8), kernel).astype(bool)
        np.testing.assert_array_equal(out[sure], self.coarse[sure])

    def test_nothing_keyed_is_a_byte_identical_no_op(self):
        opaque = self.rgba.copy()
        out, stats = refine_matte(self.rgba, opaque, MattingOptions())
        np.testing.assert_array_equal(out, opaque)
        self.assertEqual(stats["skipped"], "no-background")

    def test_thin_subject_is_refined_not_skipped(self):
        # A 5 px wide figure disappears under the default 4 px erosion; the
        # trimap must shrink its erosion instead of reporting no-foreground.
        h, w = 40, 40
        rgba = np.zeros((h, w, 4), np.uint8)
        rgba[...] = (0, 36, 245, 255)
        rgba[5:35, 18:23, :3] = (200, 120, 60)
        rgba[5:35, 17, :3] = (100, 78, 152)
        rgba[5:35, 23, :3] = (100, 78, 152)
        keyed = rgba.copy()
        keyed[..., 3] = 0
        keyed[5:35, 18:23, 3] = 255
        keyed[5:35, 17, 3] = 255
        keyed[5:35, 23, 3] = 255
        out, stats = refine_matte(rgba, keyed, MattingOptions(band=4))
        self.assertIsNone(stats["skipped"])
        self.assertGreater(stats["changedPixels"], 0)
        np.testing.assert_array_equal(out[5:35, 19:22], keyed[5:35, 19:22])

    def test_transparent_source_stays_transparent(self):
        source = self.rgba.copy()
        source[:10, :10, 3] = 0
        out, _ = refine_matte(source, self.coarse, MattingOptions())
        self.assertTrue((out[:10, :10, 3] == 0).all())

    def test_cleanup_drops_specks_and_fills_holes(self):
        keyed = np.zeros((64, 64, 4), np.uint8)
        keyed[..., 2] = 255
        keyed[16:48, 16:48] = (200, 120, 40, 255)
        keyed[30:33, 30:33, 3] = 0  # 9 px hole
        keyed[2:4, 2:4] = (200, 120, 40, 255)  # 4 px speck
        source = keyed.copy()
        source[..., 3] = 255
        out, stats = refine_matte(source, keyed, MattingOptions(band=1, min_island=10, max_hole=20, smooth=0))
        self.assertTrue((out[2:4, 2:4, 3] == 0).all())
        self.assertTrue((out[30:33, 30:33, 3] == 255).all())
        self.assertGreater(stats["holePixels"], 0)
        self.assertGreater(stats["islandPixels"], 0)


class StandaloneTest(unittest.TestCase):
    def test_auto_detect_finds_the_backdrop(self):
        rgba, _, _, key = make_scene(120)
        colors = detect_key_colors(rgba[..., :3].astype(np.float32) / 255)
        self.assertLess(np.abs(np.array(colors[0]) - key).max(), 0.15)

    def test_remove_background_matches_ground_truth(self):
        rgba, alpha_gt, _, _ = make_scene(160)
        out, stats = remove_background(rgba, KeyOptions(), MattingOptions())
        self.assertLess(np.abs(out[..., 3] / 255 - alpha_gt).mean(), 0.01)
        self.assertTrue(stats["keyColors"])

    def test_connected_keeps_enclosed_backdrop(self):
        img = np.zeros((48, 48, 3), np.uint8)
        img[:] = (0, 36, 245)
        img[8:40, 8:40] = (220, 140, 60)
        img[20:28, 20:28] = (0, 36, 245)  # pocket of key colour inside the subject
        out, _ = remove_background(img, KeyOptions(key_colors=[parse_color("#0024F5")], connected=True), MattingOptions(band=1))
        self.assertEqual(out[24, 24, 3], 255)
        self.assertEqual(out[2, 2, 3], 0)
        out, _ = remove_background(img, KeyOptions(key_colors=[parse_color("#0024F5")]), MattingOptions(band=1))
        self.assertEqual(out[24, 24, 3], 0)


class ProtocolTest(unittest.TestCase):
    def test_round_trip(self):
        stream = io.BytesIO()
        write_message(stream, {"op": "x", "n": 1}, b"\x01\x02\x03")
        stream.seek(0)
        header, payload = read_message(stream)
        self.assertEqual(header, {"op": "x", "n": 1})
        self.assertEqual(bytes(payload), b"\x01\x02\x03")
        self.assertIsNone(read_message(stream))
        header, payload = decode_body(encode_body({"a": [1]}))
        self.assertEqual(header, {"a": [1]})
        self.assertEqual(len(payload), 0)

    def test_worker_end_to_end(self):
        rgba, _, _, key = make_scene(64)
        coarse = naive_key(rgba, key)
        worker = subprocess.Popen(
            [sys.executable, os.path.join(ROOT, "worker.py")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        try:
            write_message(worker.stdin, {"op": "ping", "id": 1})
            header, _ = read_message(worker.stdout)
            self.assertTrue(header["ok"])
            self.assertEqual(header["id"], 1)

            write_message(
                worker.stdin,
                {"op": "refine", "id": 2, "width": 64, "height": 64, "options": {"keyColors": ["#0024F5"]}},
                rgba.tobytes() + coarse.tobytes(),
            )
            header, payload = read_message(worker.stdout)
            self.assertTrue(header["ok"], header)
            self.assertEqual(len(payload), 64 * 64 * 4)

            write_message(worker.stdin, {"op": "refine", "id": 3, "width": 64, "height": 64}, b"short")
            header, _ = read_message(worker.stdout)
            self.assertFalse(header["ok"])
            self.assertEqual(header["id"], 3)
        finally:
            worker.stdin.close()
            worker.wait(timeout=10)
        self.assertEqual(worker.returncode, 0)


class CliTest(unittest.TestCase):
    def test_image_round_trip(self):
        import cv2

        rgba, _, _, _ = make_scene(64)
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "in.png")
            dst = os.path.join(tmp, "out.png")
            cv2.imwrite(src, cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
            subprocess.run([sys.executable, os.path.join(ROOT, "remove_bg.py"), src, "-o", dst], check=True, capture_output=True)
            out = cv2.imread(dst, cv2.IMREAD_UNCHANGED)
            self.assertEqual(out.shape, (64, 64, 4))
            self.assertEqual(out[0, 0, 3], 0)


if __name__ == "__main__":
    unittest.main()
