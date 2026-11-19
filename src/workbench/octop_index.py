"""Private Unix socket for request-scoped Octop Memory recall."""

import fcntl
import json
import os
import re
import signal
import socket
import socketserver
import stat
import sys
import time
from pathlib import Path


MAX_REQUEST = 4 * 1024 * 1024
MAX_QUERY_BYTES = 64 * 1024 * 1024


def private_address(address):
    location = Path(address)
    parent = location.parent.stat()
    if parent.st_uid != os.getuid() or parent.st_mode & 0o077:
        raise ValueError("Octop index socket directory must be private")
    return location


def valid_request(data):
    if not isinstance(data, dict) or set(data) != {"query", "entries"}:
        return False
    query, entries = data["query"], data["entries"]
    return (
        isinstance(query, str)
        and 0 < len(query) <= 240
        and isinstance(entries, list)
        and len(entries) <= 96
        and all(
            isinstance(row, dict)
            and set(row) == {"id", "rev", "text"}
            and all(isinstance(value, str) for value in row.values())
            and 0 < len(row["id"]) <= 80
            and re.fullmatch(r"[0-9a-f]{64}", row["rev"])
            and len(row["text"]) <= 9000
            for row in entries
        )
    )


def query_index(payload):
    address = payload.pop("socket")
    location = private_address(address).lstat()
    if not stat.S_ISSOCK(location.st_mode) or location.st_uid != os.getuid() or location.st_mode & 0o077:
        raise ValueError("Octop index socket must be private")
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(12)
        connection.connect(address)
        # 96 is a transport batch size, never a limit on searchable sources.
        connection.sendall(json.dumps({"query": payload["query"], "stream": True}).encode() + b"\n")
        for offset in range(0, len(payload["entries"]), 96):
            connection.sendall(json.dumps({"entries": payload["entries"][offset:offset + 96]}, ensure_ascii=False).encode() + b"\n")
        connection.sendall(b'{"end":true}\n')
        with connection.makefile("rb") as response:
            line = response.readline(8193)
        if not line.endswith(b"\n") or len(line) > 8192:
            raise ValueError("invalid Octop index response")
    return json.loads(line)["ids"]


def serve_index(address, recall):
    location = private_address(address)
    os.umask(0o077)
    lock = os.open(address + ".lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)

    class IndexHandler(socketserver.BaseRequestHandler):
        def handle(self):
            self.request.settimeout(2)
            try:
                with self.request.makefile("rb") as incoming:
                    started = time.monotonic()
                    total = 0

                    def read_frame():
                        nonlocal total
                        line = incoming.readline(MAX_REQUEST + 1)
                        total += len(line)
                        if (not line.endswith(b"\n") or len(line) > MAX_REQUEST
                                or total > MAX_QUERY_BYTES or time.monotonic() - started > 10):
                            raise ValueError("index request limit exceeded")
                        return json.loads(line)

                    payload = read_frame()
                    if payload == {"op": "health"}:
                        # Exercise the pinned FTS backend, not just socket existence.
                        recall({"query": "contractorhealthcheck", "entries": []})
                        self.request.sendall(b'{"ready":true}\n')
                        return
                    if (isinstance(payload, dict) and set(payload) == {"query", "stream"}
                            and payload["stream"] is True):
                        query = payload["query"]
                        if not valid_request({"query": query, "entries": []}):
                            return

                        def entries():
                            while True:
                                frame = read_frame()
                                if frame == {"end": True}:
                                    return
                                if (not isinstance(frame, dict) or set(frame) != {"entries"}
                                        or not valid_request({"query": query, "entries": frame["entries"]})):
                                    raise ValueError("invalid index batch")
                                yield from frame["entries"]

                        result = recall({"query": query, "entries": entries()})
                    elif valid_request(payload):
                        result = recall(payload)
                    else:
                        return
                self.request.sendall(json.dumps({"ids": result}).encode() + b"\n")
            except (OSError, ValueError):
                return

    class IndexServer(socketserver.UnixStreamServer):
        def handle_error(self, request, client_address):
            # Keep private query contents and source passages out of logs.
            print("Octop index query failed", file=sys.stderr, flush=True)

    def stop(_signal, _frame):
        raise SystemExit(0)

    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            if not stat.S_ISSOCK(location.lstat().st_mode):
                raise ValueError("Octop index address is occupied")
            location.unlink()
        except FileNotFoundError:
            pass
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        with IndexServer(address, IndexHandler) as server:
            try:
                print("Octop index ready", flush=True)
                server.serve_forever()
            finally:
                location.unlink(missing_ok=True)
    finally:
        os.close(lock)
