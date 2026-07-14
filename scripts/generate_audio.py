#!/usr/bin/env python3
"""Generate the static Neural TTS audio library declared by audio-manifest.json."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
from typing import Any

import edge_tts


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--concurrency", type=int, default=6)
    parser.add_argument("--check-only", action="store_true")
    return parser.parse_args()


def valid_mp3(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size < 1024:
        return False
    with path.open("rb") as audio_file:
        header = audio_file.read(3)
    return header == b"ID3" or header[:1] == b"\xff"


def synthesis_text(text: str, locale: str) -> str:
    normalized = text.replace("……", "，").replace("…", " ")
    if locale == "zh-CN":
        normalized = normalized.replace("（", "").replace("）", "")
    return normalized


async def synthesize(
    text: str,
    locale: str,
    voice: str,
    target: Path,
    semaphore: asyncio.Semaphore,
) -> str | None:
    if valid_mp3(target):
        return None

    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".mp3.part")

    async with semaphore:
        for attempt in range(1, 5):
            try:
                temporary.unlink(missing_ok=True)
                communicate = edge_tts.Communicate(
                    synthesis_text(text, locale),
                    voice,
                    rate="+0%",
                    volume="+0%",
                    pitch="+0Hz",
                )
                await communicate.save(str(temporary))
                if not valid_mp3(temporary):
                    raise RuntimeError("generated file is not a valid MP3")
                os.replace(temporary, target)
                return None
            except Exception as error:  # noqa: BLE001 - retry network/service errors
                temporary.unlink(missing_ok=True)
                if attempt == 4:
                    return f"{locale}: {text!r}: {error}"
                await asyncio.sleep(attempt * 1.5)
    return None


async def main() -> None:
    args = parse_args()
    project_root = args.manifest.resolve().parents[1]
    manifest: dict[str, Any] = json.loads(args.manifest.read_text("utf8"))

    jobs: list[tuple[str, str, str, Path]] = []
    for locale, entries in manifest["entries"].items():
        voice = manifest["voices"][locale]["name"]
        for text, filename in entries.items():
            target = project_root / "public" / "audio" / locale / filename
            jobs.append((text, locale, voice, target))

    missing = [job for job in jobs if not valid_mp3(job[3])]
    print(f"Audio files: {len(jobs) - len(missing)} cached, {len(missing)} to generate.")
    if args.check_only:
        if missing:
            raise SystemExit(f"Missing or invalid audio files: {len(missing)}")
        return

    available = {voice["ShortName"] for voice in await edge_tts.list_voices()}
    required = {job[2] for job in jobs}
    unavailable = sorted(required - available)
    if unavailable:
        raise SystemExit(f"Unavailable voices: {', '.join(unavailable)}")

    semaphore = asyncio.Semaphore(max(1, args.concurrency))
    completed = 0
    progress_lock = asyncio.Lock()

    async def run_job(job: tuple[str, str, str, Path]) -> str | None:
        nonlocal completed
        result = await synthesize(*job, semaphore)
        async with progress_lock:
            completed += 1
            if completed % 25 == 0 or completed == len(missing):
                print(f"Generated {completed}/{len(missing)} new audio files.", flush=True)
        return result

    results = await asyncio.gather(*(run_job(job) for job in missing))
    errors = [result for result in results if result]
    if errors:
        print("\n".join(errors[:20]))
        raise SystemExit(f"Audio generation failed for {len(errors)} files.")

    invalid = [job[3] for job in jobs if not valid_mp3(job[3])]
    if invalid:
        raise SystemExit(f"Validation failed for {len(invalid)} audio files.")
    print(f"Audio library ready: {len(jobs)} files.")


if __name__ == "__main__":
    asyncio.run(main())
