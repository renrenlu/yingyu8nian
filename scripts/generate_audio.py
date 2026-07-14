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


CONTEXTUAL_PRONUNCIATIONS = {
    # The textbook uses the verb /rɪˈkɔːd/. An isolated "record" can be
    # synthesized as the noun, so generate it in verb context and keep only
    # the target word using Edge's word-boundary timestamps.
    "record": ("Record it.", "record"),
}
EDGE_MP3_FRAME_BYTES = 144
EDGE_MP3_FRAME_SECONDS = 0.024


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


def trim_edge_mp3(audio: bytes, start_seconds: float, end_seconds: float) -> bytes:
    if len(audio) % EDGE_MP3_FRAME_BYTES != 0:
        raise RuntimeError("unexpected Edge MP3 frame alignment")
    if not all(
        audio[offset] == 0xFF and audio[offset + 1] & 0xE0 == 0xE0
        for offset in range(0, len(audio), EDGE_MP3_FRAME_BYTES)
    ):
        raise RuntimeError("unexpected Edge MP3 frame header")

    frame_count = len(audio) // EDGE_MP3_FRAME_BYTES
    first_frame = max(0, int(start_seconds / EDGE_MP3_FRAME_SECONDS))
    last_frame = min(
        frame_count,
        int(end_seconds / EDGE_MP3_FRAME_SECONDS) + 1,
    )
    last_frame = max(first_frame + 1, last_frame)
    return audio[
        first_frame * EDGE_MP3_FRAME_BYTES : last_frame * EDGE_MP3_FRAME_BYTES
    ]


async def contextual_audio(text: str, voice: str) -> bytes | None:
    override = CONTEXTUAL_PRONUNCIATIONS.get(text)
    if override is None:
        return None

    prompt, target_word = override
    audio = bytearray()
    boundaries: list[dict[str, Any]] = []
    communicate = edge_tts.Communicate(
        prompt,
        voice,
        rate="+0%",
        volume="+0%",
        pitch="+0Hz",
        boundary="WordBoundary",
    )
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            boundaries.append(chunk)

    target_index = next(
        (
            index
            for index, item in enumerate(boundaries)
            if item["text"].lower() == target_word
        ),
        None,
    )
    if target_index is None:
        raise RuntimeError(f"word boundary not found for {text!r}")

    boundary = boundaries[target_index]
    start = boundary["offset"] / 10_000_000 - 0.12
    end = (boundary["offset"] + boundary["duration"]) / 10_000_000 + 0.18
    if target_index > 0:
        previous = boundaries[target_index - 1]
        previous_end = (previous["offset"] + previous["duration"]) / 10_000_000
        start = max(start, previous_end + 0.01)
    if target_index + 1 < len(boundaries):
        next_start = boundaries[target_index + 1]["offset"] / 10_000_000
        end = min(end, next_start - 0.01)
    return trim_edge_mp3(bytes(audio), max(0, start), end)


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
                contextual = (
                    await contextual_audio(text, voice)
                    if locale != "zh-CN"
                    else None
                )
                if contextual is not None:
                    temporary.write_bytes(contextual)
                else:
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
