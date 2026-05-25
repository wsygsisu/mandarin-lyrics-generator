#!/usr/bin/env python3
import asyncio
import sys
import json
import os

# Point pydub at the bundled ffmpeg so the warning is silenced
try:
    import imageio_ffmpeg
    ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
    os.environ["PATH"] = os.path.dirname(ffmpeg_path) + ":" + os.environ.get("PATH", "")
    from pydub import AudioSegment
    AudioSegment.converter = ffmpeg_path
except Exception:
    pass

from shazamio import Shazam


async def identify(filepath: str) -> dict:
    shazam = Shazam()
    result = await shazam.recognize(filepath)

    if not result or not result.get("matches"):
        return {"error": "Could not identify the music in this clip"}

    track = result.get("track", {})
    images = track.get("images", {})

    info = {
        "title": track.get("title", ""),
        "artist": track.get("subtitle", ""),
        "album": "",
        "releaseDate": "",
        "genre": "",
        "coverArt": images.get("coverart", "") or images.get("coverarthq", ""),
    }

    # Extract album, release date from sections metadata
    for section in track.get("sections", []):
        for meta in section.get("metadata", []):
            title = meta.get("title", "")
            text = meta.get("text", "")
            if title == "Album":
                info["album"] = text
            elif title == "Released":
                info["releaseDate"] = text

    # Genre
    genres = track.get("genres", {})
    if genres:
        info["genre"] = genres.get("primary", "")

    return info


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No audio file path provided"}))
        sys.exit(1)
    result = asyncio.run(identify(sys.argv[1]))
    print(json.dumps(result, ensure_ascii=False))
