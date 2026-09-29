"""Fetch public reset signals for the static dashboard. No credentials are used."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "site" / "data" / "snapshot.json"
RECORDS_URL = "https://didcodexreset.com/openapi/v1/records?kind=all&page=1&pageSize=10"
LATEST_URL = "https://didcodexreset.com/openapi/v1/records/latest?kind=reset_completed"
STATUS_URL = "https://status.openai.com/api/v2/status.json"
INCIDENTS_URL = "https://status.openai.com/api/v2/incidents.json"
USER_AGENT = "codex-reset-radar/1.0 (+public GitHub Pages project)"


def fetch_json(url: str) -> dict:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
    with urlopen(request, timeout=15) as response:
        raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError(f"Response too large: {url}")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected a JSON object: {url}")
    return payload


def require_api_data(payload: dict, *, list_result: bool) -> tuple[object, dict]:
    if payload.get("ok") is not True or not isinstance(payload.get("meta"), dict):
        raise ValueError("Reset signal API returned an invalid response")
    data = payload.get("data")
    if list_result and (not isinstance(data, dict) or not isinstance(data.get("items"), list)):
        raise ValueError("Reset signal list is missing")
    if not list_result and data is not None and not isinstance(data, dict):
        raise ValueError("Latest reset signal is invalid")
    return data, payload["meta"]


def normalize_record(record: dict) -> dict:
    if not isinstance(record, dict) or not isinstance(record.get("id"), str):
        raise ValueError("Invalid reset record")
    if record.get("kind") not in {"reset_scheduled", "reset_completed"}:
        raise ValueError("Unknown reset record kind")
    if record.get("resetType") not in {"global", "banked", "global_and_banked"}:
        raise ValueError("Unknown reset type")
    source = record.get("source") or {}
    scope = record.get("scope") or {}
    return {
        "id": record["id"],
        "kind": record["kind"],
        "resetType": record["resetType"],
        "announcedAt": record.get("announcedAt"),
        "effectiveAt": record.get("effectiveAt"),
        "completedAt": record.get("completedAt"),
        "scheduleWindow": record.get("scheduleWindow"),
        "scheduleState": record.get("scheduleState"),
        "schedulePrecision": record.get("schedulePrecision"),
        "scheduleBasis": record.get("scheduleBasis"),
        "scope": {"plans": scope.get("plans", []), "windows": scope.get("windows", [])},
        "source": {"url": source.get("url"), "handle": source.get("handle")},
        "text": (record.get("text") or "")[:1000],
    }


def parse_iso(value: str | None) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def build_snapshot(payloads: dict, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    list_data, list_meta = require_api_data(payloads["records"], list_result=True)
    latest_data, _ = require_api_data(payloads["latest"], list_result=False)
    by_id = {}
    for record in [*list_data["items"], *([latest_data] if latest_data else [])]:
        normalized = normalize_record(record)
        by_id[normalized["id"]] = normalized

    status_payload = payloads["status"]
    status = status_payload.get("status")
    if not isinstance(status, dict) or not isinstance(status.get("indicator"), str):
        raise ValueError("OpenAI status response is invalid")
    incidents_payload = payloads["incidents"]
    raw_incidents = incidents_payload.get("incidents")
    if not isinstance(raw_incidents, list):
        raise ValueError("OpenAI incident response is invalid")
    cutoff = now - timedelta(days=7)
    incidents = []
    for incident in raw_incidents:
        if not isinstance(incident, dict):
            continue
        created = parse_iso(incident.get("created_at"))
        name = incident.get("name")
        if not isinstance(name, str) or not created or created < cutoff:
            continue
        if "codex" not in name.lower() and "chatgpt work" not in name.lower():
            continue
        identifier = incident.get("id")
        incidents.append({
            "id": identifier,
            "name": name[:160],
            "status": incident.get("status"),
            "impact": incident.get("impact"),
            "createdAt": incident.get("created_at"),
            "url": f"https://status.openai.com/incidents/{identifier}" if isinstance(identifier, str) else "https://status.openai.com/",
        })

    def iso(value: datetime) -> str:
        return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    return {
        "schemaVersion": 1,
        "checkedAt": iso(now),
        "sources": {
            "recordsLastSuccessfulCheckAt": list_meta.get("lastSuccessfulCheckAt"),
            "recordsGeneratedAt": list_meta.get("generatedAt"),
            "statusPageUpdatedAt": status_payload.get("page", {}).get("updated_at"),
        },
        "records": list(by_id.values()),
        "status": {"indicator": status["indicator"], "description": status.get("description", "Unknown")},
        "incidents": incidents[:5],
    }


def write_snapshot(path: Path, snapshot: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n"
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(content)
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--fixture", type=Path, help="Read upstream responses from a local JSON fixture")
    args = parser.parse_args()
    try:
        payloads = json.loads(args.fixture.read_text(encoding="utf-8")) if args.fixture else {
            "records": fetch_json(RECORDS_URL),
            "latest": fetch_json(LATEST_URL),
            "status": fetch_json(STATUS_URL),
            "incidents": fetch_json(INCIDENTS_URL),
        }
        snapshot = build_snapshot(payloads)
        write_snapshot(args.output, snapshot)
        print(f"Wrote {args.output} with {len(snapshot['records'])} reset records")
        return 0
    except (HTTPError, URLError, OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"Snapshot refresh failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
