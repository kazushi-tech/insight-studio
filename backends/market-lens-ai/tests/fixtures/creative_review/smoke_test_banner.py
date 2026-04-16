"""Generate a minimal PNG for smoke test upload."""

import struct
import zlib


def create_minimal_png(width: int = 300, height: int = 250) -> bytes:
    """Create a minimal valid PNG image (solid red rectangle)."""

    def _chunk(chunk_type: bytes, data: bytes) -> bytes:
        raw = chunk_type + data
        return struct.pack(">I", len(data)) + raw + struct.pack(">I", zlib.crc32(raw) & 0xFFFFFFFF)

    # IHDR
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    ihdr = _chunk(b"IHDR", ihdr_data)

    # IDAT — solid red pixels
    raw_rows = b""
    for _ in range(height):
        raw_rows += b"\x00"  # filter byte
        raw_rows += b"\xe5\x3e\x3e" * width  # red pixels

    idat = _chunk(b"IDAT", zlib.compress(raw_rows))
    iend = _chunk(b"IEND", b"")

    return b"\x89PNG\r\n\x1a\n" + ihdr + idat + iend


if __name__ == "__main__":
    import os

    out_path = os.path.join(os.path.dirname(__file__), "smoke_test_banner.png")
    with open(out_path, "wb") as f:
        f.write(create_minimal_png())
    print(f"Created {out_path}")
