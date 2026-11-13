#!/usr/bin/env python3
"""Copy the client's art into this editor's bundled assets/ and refresh assets/index.json.

The editor is a static page, so pickers read assets/index.json and files under
assets/. They cannot see the private client repo. Run this whenever new-ui
client art changes (new item icons, gear, mobs, tiles, fx, and so on).

  python3 tools/sync-client-assets.py /path/to/BrawlQuest-Client

Copies PNG, CREDITS.txt and assets/fx/index.json from the folders the pickers
use. Leaves editor-only files in place (assets/ui/studio, and anything not in
the client). Does not copy audio, marketing screenshots, HUD chrome, or the
maps/ duplicate tree.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

# Folders the sprite pickers and the map/NPC/item/mob/skill forms show.
INCLUDE = (
    "auras",
    "critter",
    "error.png",
    "fx",
    "gore",
    "items",
    "leaves",
    "monsters",
    "npc",
    "player",
    "skills",
    "world",
)

KEEP_SUFFIXES = {".png", ".txt"}  # .txt is CREDITS next to fx/skills
KEEP_NAMES = {"index.json"}  # assets/fx/index.json, the effect-sprite manifest


def rel_posix(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def included(rel: str) -> bool:
    for inc in INCLUDE:
        if rel == inc or rel.startswith(inc + "/"):
            return True
    return False


def should_copy(rel: str, path: Path) -> bool:
    if not included(rel):
        return False
    if path.name in KEEP_NAMES:
        return True
    return path.suffix.lower() in KEEP_SUFFIXES


def sync(client: Path, dest: Path) -> None:
    src_root = client / "assets"
    if not src_root.is_dir():
        sys.exit(f"No assets/ folder in {client}")
    added = updated = same = 0
    for src in sorted(src_root.rglob("*"), key=lambda p: rel_posix(p, src_root).lower()):
        if not src.is_file():
            continue
        rel = rel_posix(src, src_root)
        if not should_copy(rel, src):
            continue
        out = dest / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        existed = out.exists()
        if existed and out.read_bytes() == src.read_bytes():
            same += 1
            continue
        shutil.copy2(src, out)
        if existed:
            updated += 1
        else:
            added += 1

    pngs = sorted(
        "assets/" + rel_posix(p, dest)
        for p in dest.rglob("*.png")
    )
    index = dest / "index.json"
    index.write_text(json.dumps(pngs, indent=0) + "\n", encoding="utf-8")
    print(f"copied from {client}: {added} added, {updated} updated, {same} already current")
    print(f"wrote {index} ({len(pngs)} pngs)")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("client", type=Path, help="path to a BrawlQuest-Client checkout (new-ui)")
    p.add_argument(
        "--editor",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="editor repo root (default: this repo)",
    )
    args = p.parse_args()
    dest = (args.editor / "assets").resolve()
    if not dest.is_dir():
        sys.exit(f"No editor assets/ at {dest}")
    sync(args.client.resolve(), dest)


if __name__ == "__main__":
    main()
