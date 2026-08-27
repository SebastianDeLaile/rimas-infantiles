#!/usr/bin/env python3
"""Generate/edit an illustration via OpenAI's gpt-image-1 model.

Usage:
  python3 scripts/generate_illustration.py --prompt "..." --out assets/foo.png [--ref assets/caracol.png ...]

With no --ref, calls /v1/images/generations. With --ref, calls /v1/images/edits
(gpt-image-1 supports multiple reference images for style/composition context).

Reads OPENAI_API_KEY from .env (KEY=value, one per line) in the project root, or from the
environment if already set.
"""
import argparse
import base64
import json
import mimetypes
import os
import sys
import urllib.request
import urllib.error
import uuid

GENERATIONS_URL = "https://api.openai.com/v1/images/generations"
EDITS_URL = "https://api.openai.com/v1/images/edits"


def load_api_key():
    key = os.environ.get("OPENAI_API_KEY")
    if key:
        return key
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("OPENAI_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def call_generations(api_key, prompt, size, background):
    body = {"model": "gpt-image-1", "prompt": prompt, "size": size, "n": 1, "background": background}
    req = urllib.request.Request(
        GENERATIONS_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def call_edits(api_key, prompt, ref_paths, size, background):
    boundary = uuid.uuid4().hex
    parts = []

    def add_field(name, value):
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode("utf-8")
        )

    def add_file(name, path):
        mime, _ = mimetypes.guess_type(path)
        with open(path, "rb") as f:
            data = f.read()
        filename = os.path.basename(path)
        header = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
            f'Content-Type: {mime or "image/png"}\r\n\r\n'
        ).encode("utf-8")
        parts.append(header + data + b"\r\n")

    add_field("model", "gpt-image-1")
    add_field("prompt", prompt)
    add_field("size", size)
    add_field("background", background)
    for path in ref_paths:
        add_file("image[]", path)
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))

    body = b"".join(parts)
    req = urllib.request.Request(
        EDITS_URL,
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ref", action="append", default=[], help="Reference image path (repeatable)")
    ap.add_argument("--size", default="1536x1024")
    ap.add_argument("--background", default="transparent", choices=["auto", "transparent", "opaque"])
    args = ap.parse_args()

    api_key = load_api_key()
    if not api_key:
        print("No OPENAI_API_KEY found (checked env and .env). Add it to .env as OPENAI_API_KEY=...", file=sys.stderr)
        sys.exit(1)

    try:
        if args.ref:
            result = call_edits(api_key, args.prompt, args.ref, args.size, args.background)
        else:
            result = call_generations(api_key, args.prompt, args.size, args.background)
    except urllib.error.HTTPError as e:
        print(f"API error {e.code}: {e.read().decode('utf-8')}", file=sys.stderr)
        sys.exit(1)

    data = result.get("data", [])
    if not data or "b64_json" not in data[0]:
        print(f"No image in response: {json.dumps(result, indent=2)}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    with open(args.out, "wb") as f:
        f.write(base64.b64decode(data[0]["b64_json"]))

    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
