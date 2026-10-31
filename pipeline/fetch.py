"""Polite downloads of public exchange files."""
import io
import threading
import time
import zipfile

import requests

HEADERS = {"User-Agent": "Mozilla/5.0 (stock-analyzer personal research)"}
PAUSE_SECONDS = 0.3

_local = threading.local()


def _session():
    # One session per thread; backfills download several days in parallel.
    if not hasattr(_local, "session"):
        _local.session = requests.Session()
        _local.session.headers.update(HEADERS)
    return _local.session


def get(url, retries=3, timeout=60, html=False):
    """Return the response body, or None when the file does not exist.

    BSE answers missing files with an HTML page and status 200, so HTML
    bodies are treated as missing too, unless html=True (for web pages).
    """
    for attempt in range(retries):
        time.sleep(PAUSE_SECONDS)
        try:
            r = _session().get(url, timeout=timeout)
        except requests.RequestException:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt * 5)
            continue
        if r.status_code == 404:
            return None
        if r.status_code >= 500 or r.status_code == 429:
            time.sleep(2 ** attempt * 5)
            continue
        r.raise_for_status()
        if not html and r.content[:200].lstrip().lower().startswith((b"<!doctype html", b"<html")):
            return None
        return r.content
    return None


def unzip_single(content):
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        return z.read(z.namelist()[0])
