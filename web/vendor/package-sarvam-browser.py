"""Repackage the official Sarvam SDK's browser files without platform dependencies.

Run with python3 when refreshing the SDK, then update the file spec and npm lockfile.
The build consumes the checked-in archive, so ordinary npm installs do not run this script.
"""
import gzip
import hashlib
import io
import json
import tarfile
import urllib.request
from pathlib import Path

VERSION = "0.0.42"
URL = f"https://registry.npmjs.org/sarvam-conv-ai-sdk/-/sarvam-conv-ai-sdk-{VERSION}.tgz"
# npm view sarvam-conv-ai-sdk@0.0.42 dist.integrity
SHA512 = "f097e91cd9674caece7dfce33244d668e7791878a0b53e4a0957765aa4d789c8120298bfcb56efd99b287c72ef68ec7ea46bc7a94881c9541aa2add6bc3d666a"
BROWSER_FILES = ("dist/browser.", "dist/conversation.", "dist/interfaces/browser.")
DIRECTORIES = ("dist/modules/", "dist/types/", "dist/utils/")
MANIFEST = {
    "name": "sarvam-conv-ai-sdk",
    "version": VERSION,
    "license": "MIT",
    "description": "Browser-only distribution of the Sarvam Conversational AI SDK",
    "exports": {"./browser": {"types": "./dist/browser.d.ts", "default": "./dist/browser.js"}},
    "browser": {"ws": False},
}

def include(name):
    return name == "LICENSE" or (
        name.startswith(BROWSER_FILES + DIRECTORIES) and name.endswith((".js", ".d.ts", ".map"))
    )

def write_member(archive, name, data):
    member = tarfile.TarInfo(f"package/{name}")
    member.size = len(data)
    member.mode = 0o644
    archive.addfile(member, io.BytesIO(data))

with urllib.request.urlopen(URL, timeout=30) as response:
    upstream = response.read()
if hashlib.sha512(upstream).hexdigest() != SHA512:
    raise SystemExit("Unexpected digest for the published Sarvam SDK")

with tarfile.open(fileobj=io.BytesIO(upstream), mode="r:gz") as source:
    packaged = io.BytesIO()
    with gzip.GzipFile(fileobj=packaged, mode="wb", mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w") as output:
            write_member(output, "package.json", json.dumps(MANIFEST, indent=2).encode() + b"\n")
            for member in sorted(source.getmembers(), key=lambda item: item.name):
                name = member.name.removeprefix("package/")
                if member.isfile() and include(name):
                    write_member(output, name, source.extractfile(member).read())

target = Path(__file__).with_name(f"sarvam-conv-ai-sdk-browser-{VERSION}.tgz")
target.write_bytes(packaged.getvalue())
