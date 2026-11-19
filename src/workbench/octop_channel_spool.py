"""Gateway transport persistence. Workbench owns the business database."""

import hashlib
import json
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from time import time


def connect(file):
    db = sqlite3.connect(Path(file).as_uri() + "?mode=rw", uri=True, timeout=2)
    db.execute("PRAGMA synchronous=FULL")
    db.execute("PRAGMA secure_delete=ON")
    return db


def identity(address, reply=False):
    fields = ("chat", "thread", "message", "sender", "direct") if reply else ("chat", "thread", "message")
    parts = [address.get(key, "") for key in fields]
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


class GatewaySpool:
    def __init__(self, file, connectors=None):
        self.file = file
        self.connectors = None if connectors is None else {row["id"]: row for row in connectors}

    def accept(self, event, endpoint=None):
        address = event["address"]
        if self.connectors is not None:
            connector = self.connectors.get(address["connector"])
            if not connector or connector["kind"] != address["kind"]:
                return
            if event["text"].startswith("/绑定协作 "):
                if not address["direct"] or not connector.get("allowAccountBinding"):
                    return
            elif not any(route["chat"] == address["chat"] and route.get("thread") == address.get("thread")
                         for route in connector["routes"]):
                return
        namespace, event_id = "octop:" + address["connector"], identity(address)
        lane = json.dumps([address["chat"], address.get("thread")], ensure_ascii=False)
        now = int(time() * 1000)
        with closing(connect(self.file)) as db, db:
            db.execute("""INSERT OR IGNORE INTO ingress_event(app,id,kind,lane,line,received,due)
                SELECT ?,?,'message',?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM ingress_ack WHERE app=? AND id=?)""",
                (namespace, event_id, lane, json.dumps(event, ensure_ascii=False), now, now, namespace, event_id))
            if endpoint:
                # A replay must preserve the lifetime of an already captured session route.
                db.execute("""INSERT OR IGNORE INTO ingress_reply_route(app,id,endpoint,expires) VALUES (?,?,?,?)""",
                           (namespace, identity(address, reply=True), endpoint, now + 20 * 60 * 1000))

    def route(self, address):
        with closing(connect(self.file)) as db:
            row = db.execute("SELECT endpoint FROM ingress_reply_route WHERE app=? AND id=? AND expires>?",
                             ("octop:" + address["connector"], identity(address, reply=True), int(time() * 1000))).fetchone()
            return row[0] if row else None


def save_delivery(file, delivery, connector, form):
    if not isinstance(delivery, str) or not re.fullmatch(r"[0-9a-f]{32}", delivery):
        raise ValueError("Invalid delivery identifier")
    with closing(connect(file)) as db, db:
        updated = db.execute("""UPDATE channel_delivery SET acknowledged_at=?,form=?,uncertain_at=NULL
            WHERE id=? AND connector=? AND acknowledged_at IS NULL""",
            (datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"), form, delivery, connector))
        if updated.rowcount != 1:
            raise RuntimeError("Unregistered Gateway delivery")
