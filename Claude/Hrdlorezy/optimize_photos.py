#!/usr/bin/env python3
"""Optimize photos from Hrdlořezy for web gallery.

Reads PNG originals, creates JPEG thumbnails + medium versions,
and generates a manifest.json for the web app.
"""

import json
from pathlib import Path

from PIL import Image

SOURCE = Path.home() / "Pictures" / "REALITY" / "Hrdlořezy"
OUTPUT = Path(__file__).parent / "photos"

THUMB_DIR = OUTPUT / "thumb"
MEDIUM_DIR = OUTPUT / "medium"

THUMB_MAX = (400, 400)
MEDIUM_MAX = (1600, 1600)
JPEG_Q_THUMB = 80
JPEG_Q_MEDIUM = 85


def optimize():
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    MEDIUM_DIR.mkdir(parents=True, exist_ok=True)

    pngs = sorted(SOURCE.glob("*.png"))
    print(f"Found {len(pngs)} PNG files in {SOURCE}")

    manifest = []

    for i, src in enumerate(pngs, 1):
        stem = src.stem
        print(f"[{i}/{len(pngs)}] {stem}...", end=" ", flush=True)

        img = Image.open(src)
        img = img.convert("RGB")

        # Thumbnail
        thumb = img.copy()
        thumb.thumbnail(THUMB_MAX, Image.LANCZOS)
        thumb.save(THUMB_DIR / f"{stem}.jpg", "JPEG", quality=JPEG_Q_THUMB)

        # Medium
        med = img.copy()
        med.thumbnail(MEDIUM_MAX, Image.LANCZOS)
        med.save(MEDIUM_DIR / f"{stem}.jpg", "JPEG", quality=JPEG_Q_MEDIUM)

        manifest.append(stem)
        print("OK")

    # Write manifest
    manifest_path = OUTPUT / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print(f"\nDone! {len(manifest)} photos optimized.")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    optimize()
