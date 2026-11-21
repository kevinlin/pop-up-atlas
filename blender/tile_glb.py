"""Bundle Blender's extracted geometry while sharing the glTF image resources."""
from hashlib import sha256
import json
from pathlib import Path
import re
import struct
from urllib.parse import unquote


def pad4(data, fill):
    return data + fill * (-len(data) % 4)


def package(gltf: Path, output: Path, textures: dict) -> None:
    source = json.loads(gltf.read_text())
    (buffer,) = source["buffers"]
    geometry = (gltf.parent / unquote(buffer.pop("uri"))).read_bytes()
    if len(geometry) != buffer["byteLength"]:
        raise ValueError(f"{gltf.name}: geometry byte length differs from glTF metadata")

    shared = output.parent / "textures"
    shared.mkdir(exist_ok=True)
    for image in source["images"]:
        local = gltf.parent / unquote(image["uri"])
        data = local.read_bytes()
        if not data.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError(f"{gltf.name}: expected a PNG from Blender for {local.name}")
        key = sha256(data).hexdigest()
        if key not in textures:
            stem = re.sub(r"[^a-z0-9_-]+", "-", local.stem.lower()).strip("-")
            textures[key] = f"{stem}-{key[:12]}.png"
            (shared / textures[key]).write_bytes(data)
        image["uri"] = "textures/" + textures[key]

    metadata = pad4(json.dumps(source, separators=(",", ":")).encode(), b" ")
    geometry = pad4(geometry, b"\0")
    length = 12 + 8 + len(metadata) + 8 + len(geometry)
    with output.open("xb") as result:
        result.write(struct.pack("<4sII", b"glTF", 2, length))
        result.write(struct.pack("<I4s", len(metadata), b"JSON"))
        result.write(metadata)
        result.write(struct.pack("<I4s", len(geometry), b"BIN\0"))
        result.write(geometry)
