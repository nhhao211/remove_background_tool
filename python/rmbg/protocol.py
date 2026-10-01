"""Length-prefixed binary framing shared by the worker and the Node bridge.

One message is::

    u32le body_length
    body = u32le header_length | header (UTF-8 JSON) | payload (raw bytes)

The HTTP endpoint ``POST /api/python/matte`` uses the same *body* layout, so
Node forwards a request to the worker without re-encoding pixels.
"""

from __future__ import annotations

import json
import struct

MAX_BODY = 1 << 31  # 2 GiB; a 4K RGBA pair is ~66 MB


def encode_body(header: dict, payload: bytes = b"") -> bytes:
    raw = json.dumps(header, separators=(",", ":")).encode("utf-8")
    return struct.pack("<I", len(raw)) + raw + payload


def decode_body(body: bytes):
    if len(body) < 4:
        raise ValueError("body too short")
    (length,) = struct.unpack_from("<I", body, 0)
    if 4 + length > len(body):
        raise ValueError("header length exceeds body")
    header = json.loads(body[4 : 4 + length].decode("utf-8"))
    if not isinstance(header, dict):
        raise ValueError("header must be a JSON object")
    return header, memoryview(body)[4 + length :]


def read_exact(stream, size: int):
    chunks = []
    remaining = size
    while remaining > 0:
        chunk = stream.read(remaining)
        if not chunk:
            return None
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_message(stream):
    """Next ``(header, payload)`` from ``stream``, or ``None`` at EOF."""
    prefix = read_exact(stream, 4)
    if prefix is None:
        return None
    (size,) = struct.unpack("<I", prefix)
    if size > MAX_BODY:
        raise ValueError(f"message of {size} bytes is too large")
    body = read_exact(stream, size)
    if body is None:
        return None
    return decode_body(body)


def write_message(stream, header: dict, payload: bytes = b"") -> None:
    body = encode_body(header, payload)
    stream.write(struct.pack("<I", len(body)))
    stream.write(body)
    stream.flush()
