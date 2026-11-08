#!/usr/bin/env python3
"""Create private PostgreSQL and essential-file backups in the Genesis bucket."""

from __future__ import annotations

import datetime as dt
import http.client
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
from urllib.parse import quote
from urllib.request import Request, urlopen


BUCKET = "kallistis-genesis-backups-6601423207"
METADATA_TOKEN_URL = (
    "http://metadata.google.internal/computeMetadata/v1/"
    "instance/service-accounts/default/token"
)
UPLOAD_HOST = "storage.googleapis.com"


def access_token() -> str:
    request = Request(METADATA_TOKEN_URL, headers={"Metadata-Flavor": "Google"})
    with urlopen(request, timeout=10) as response:
        payload = json.load(response)
    return str(payload["access_token"])


def upload(path: Path, object_name: str, token: str) -> None:
    connection = http.client.HTTPSConnection(UPLOAD_HOST, timeout=120)
    endpoint = (
        f"/upload/storage/v1/b/{BUCKET}/o?uploadType=media&name="
        f"{quote(object_name, safe='/')}"
    )
    connection.putrequest("POST", endpoint)
    connection.putheader("Authorization", f"Bearer {token}")
    connection.putheader("Content-Type", "application/octet-stream")
    connection.putheader("Content-Length", str(path.stat().st_size))
    connection.endheaders()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            connection.send(chunk)
    response = connection.getresponse()
    body = response.read()
    if response.status not in (200, 201):
        raise RuntimeError(f"GCS upload failed with HTTP {response.status}")
    metadata = json.loads(body)
    print(f"uploaded={metadata.get('name')} generation={metadata.get('generation')}")
    connection.close()


def add_if_present(archive: tarfile.TarFile, source: Path, name: str) -> None:
    if source.exists():
        archive.add(source, arcname=name, recursive=True)


def main() -> None:
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    with tempfile.TemporaryDirectory(prefix="kallistis-backup-") as temporary:
        work = Path(temporary)
        database_dump = work / f"database-{stamp}.dump"
        files_archive = work / f"files-{stamp}.tar.gz"

        with database_dump.open("wb") as output:
            subprocess.run(
                ["runuser", "-u", "postgres", "--", "pg_dump", "--format=custom", "--dbname=kallistis_genesis"],
                stdout=output,
                check=True,
            )
        os.chmod(database_dump, 0o600)

        release = Path("/opt/kallistis/current")
        with tarfile.open(files_archive, "w:gz") as archive:
            for relative in (
                "app/dist",
                "package.json",
                "bun.lock",
                "scripts/serve-bun.ts",
                "bin/zeroclaw",
            ):
                add_if_present(archive, release / relative, f"kallistis-release/{relative}")
            add_if_present(archive, Path("/etc/kallistis"), "etc/kallistis")
            add_if_present(archive, Path("/etc/caddy/Caddyfile"), "etc/caddy/Caddyfile")
            add_if_present(archive, Path("/var/lib/kallistis/gallery"), "var/lib/kallistis/gallery")
        os.chmod(files_archive, 0o600)

        token = access_token()
        upload(database_dump, f"daily/{database_dump.name}", token)
        upload(files_archive, f"daily/{files_archive.name}", token)


if __name__ == "__main__":
    main()
