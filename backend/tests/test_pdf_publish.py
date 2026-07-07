"""Preservia — Catalog & Library PDF publish flow tests (GridFS-backed).

Verifies the bug fix: publishing PDFs no longer fails on >16MB inline docs
because storage moved to GridFS.
"""
import base64
import os
import uuid
from pathlib import Path

import pytest
import requests


def _base_url() -> str:
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if not url:
        for line in Path("/app/frontend/.env").read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                url = line.split("=", 1)[1].strip().strip('"')
                break
    assert url, "EXPO_PUBLIC_BACKEND_URL not set"
    return url.rstrip("/")


BASE_URL = _base_url()
API = f"{BASE_URL}/api"

ADMIN = {"email": "test@preservia.com", "password": "secret123"}
UNIQUE = uuid.uuid4().hex[:8]
NON_ADMIN = {
    "email": f"buguser_{UNIQUE}@test.com",
    "password": "secret123",
    "name": "TEST NonAdmin",
}

state: dict = {}


def _small_pdf_b64() -> str:
    """Minimal valid PDF (~250 bytes)."""
    pdf = (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f\n"
        b"0000000010 00000 n\n0000000053 00000 n\n0000000102 00000 n\n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n156\n%%EOF\n"
    )
    return base64.b64encode(pdf).decode()


def _large_pdf_b64(target_mb: int = 12) -> str:
    """Valid PDF header followed by padding so the base64 payload exceeds
    the old 16MB Mongo BSON inline limit when target_mb>=12."""
    header = b"%PDF-1.4\n%stub for large test\n"
    padding = b"A" * (target_mb * 1024 * 1024)
    tail = b"\n%%EOF\n"
    return base64.b64encode(header + padding + tail).decode()


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# --------------------- Auth setup ---------------------
def test_admin_login(s):
    r = s.post(f"{API}/auth/login", json=ADMIN, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["user"]["is_admin"] is True, "test@preservia.com must be admin"
    state["admin_token"] = d["access_token"]


def test_register_non_admin(s):
    r = s.post(f"{API}/auth/register", json=NON_ADMIN, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["user"]["is_admin"] is False
    state["user_token"] = d["access_token"]


def _admin():
    return {"Authorization": f"Bearer {state['admin_token']}"}


def _user():
    return {"Authorization": f"Bearer {state['user_token']}"}


# --------------------- Catalog: Fichas Técnicas ---------------------
def test_publish_catalog_ficha_tecnica(s):
    payload = {
        "title": "TEST Ficha Tecnica",
        "filename": "TEST_ficha.pdf",
        "category": "ficha_tecnica",
        "pdf_base64": _small_pdf_b64(),
    }
    r = s.post(f"{API}/catalog/documents", headers=_admin(), json=payload, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()["document"]
    assert d["doc_id"].startswith("cat_")
    assert d["category"] == "ficha_tecnica"
    assert "pdf_base64" not in d  # PDF payload not echoed back
    state["ficha_id"] = d["doc_id"]


def test_publish_catalog_hoja_seguridad(s):
    payload = {
        "title": "TEST Hoja Seguridad",
        "filename": "TEST_hoja.pdf",
        "category": "hoja_seguridad",
        "pdf_base64": _small_pdf_b64(),
    }
    r = s.post(f"{API}/catalog/documents", headers=_admin(), json=payload, timeout=30)
    assert r.status_code == 200, r.text
    state["hoja_id"] = r.json()["document"]["doc_id"]


def test_publish_catalog_large_pdf_gridfs(s):
    """This is the bug-fix regression: a >12MB payload used to 500 on Mongo BSON limit."""
    payload = {
        "title": "TEST Large Ficha",
        "filename": "TEST_large.pdf",
        "category": "ficha_tecnica",
        "pdf_base64": _large_pdf_b64(12),
    }
    r = s.post(f"{API}/catalog/documents", headers=_admin(), json=payload, timeout=90)
    assert r.status_code == 200, r.text[:300]
    state["large_id"] = r.json()["document"]["doc_id"]


def test_list_catalog_by_category(s):
    r = s.get(f"{API}/catalog/documents", params={"category": "ficha_tecnica"}, headers=_user(), timeout=20)
    assert r.status_code == 200
    ids = [d["doc_id"] for d in r.json()["documents"]]
    assert state["ficha_id"] in ids
    # metadata only
    sample = next(d for d in r.json()["documents"] if d["doc_id"] == state["ficha_id"])
    assert "pdf_base64" not in sample
    assert "grid_id" not in sample

    r2 = s.get(f"{API}/catalog/documents", params={"category": "hoja_seguridad"}, headers=_user(), timeout=20)
    assert r2.status_code == 200
    assert state["hoja_id"] in [d["doc_id"] for d in r2.json()["documents"]]


def test_get_catalog_document_returns_pdf_base64(s):
    r = s.get(f"{API}/catalog/documents/{state['ficha_id']}", headers=_user(), timeout=30)
    assert r.status_code == 200
    d = r.json()["document"]
    assert d["pdf_base64"], "pdf_base64 must be non-empty"
    raw = base64.b64decode(d["pdf_base64"])
    assert raw[:4] == b"%PDF"


def test_get_catalog_large_document(s):
    r = s.get(f"{API}/catalog/documents/{state['large_id']}", headers=_user(), timeout=90)
    assert r.status_code == 200
    d = r.json()["document"]
    raw = base64.b64decode(d["pdf_base64"])
    assert raw[:4] == b"%PDF"
    assert len(raw) > 10 * 1024 * 1024


def test_invalid_category_400(s):
    r = s.post(
        f"{API}/catalog/documents",
        headers=_admin(),
        json={
            "title": "x",
            "filename": "x.pdf",
            "category": "bogus",
            "pdf_base64": _small_pdf_b64(),
        },
        timeout=20,
    )
    assert r.status_code == 400


def test_invalid_pdf_base64_400(s):
    r = s.post(
        f"{API}/catalog/documents",
        headers=_admin(),
        json={
            "title": "x",
            "filename": "x.pdf",
            "category": "ficha_tecnica",
            "pdf_base64": "@@@not-base64@@@",
        },
        timeout=20,
    )
    assert r.status_code == 400


# --------------------- Permissions ---------------------
def test_non_admin_cannot_publish_catalog(s):
    r = s.post(
        f"{API}/catalog/documents",
        headers=_user(),
        json={
            "title": "TEST forbidden",
            "filename": "x.pdf",
            "category": "ficha_tecnica",
            "pdf_base64": _small_pdf_b64(),
        },
        timeout=20,
    )
    assert r.status_code == 403, r.text


def test_non_admin_can_view_catalog(s):
    r = s.get(f"{API}/catalog/documents/{state['ficha_id']}", headers=_user(), timeout=20)
    assert r.status_code == 200
    assert r.json()["document"]["pdf_base64"]


def test_non_admin_cannot_delete(s):
    r = s.delete(f"{API}/catalog/documents/{state['ficha_id']}", headers=_user(), timeout=20)
    assert r.status_code == 403


# --------------------- Personal library ---------------------
def test_library_upload_small(s):
    r = s.post(
        f"{API}/library/documents",
        headers=_user(),
        json={
            "title": "TEST Personal",
            "filename": "TEST_personal.pdf",
            "pdf_base64": _small_pdf_b64(),
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    state["lib_id"] = r.json()["document"]["doc_id"]


def test_library_upload_large(s):
    r = s.post(
        f"{API}/library/documents",
        headers=_user(),
        json={
            "title": "TEST Personal Large",
            "filename": "TEST_personal_large.pdf",
            "pdf_base64": _large_pdf_b64(12),
        },
        timeout=90,
    )
    assert r.status_code == 200, r.text[:300]
    state["lib_large_id"] = r.json()["document"]["doc_id"]


def test_library_get_returns_pdf_base64(s):
    r = s.get(f"{API}/library/documents/{state['lib_id']}", headers=_user(), timeout=30)
    assert r.status_code == 200
    d = r.json()["document"]
    raw = base64.b64decode(d["pdf_base64"])
    assert raw[:4] == b"%PDF"


def test_library_isolation(s):
    """Admin should NOT see the non-admin user's personal doc."""
    r = s.get(f"{API}/library/documents/{state['lib_id']}", headers=_admin(), timeout=20)
    assert r.status_code == 404


# --------------------- Cleanup ---------------------
def test_delete_library_docs(s):
    for k in ("lib_id", "lib_large_id"):
        did = state.get(k)
        if did:
            r = s.delete(f"{API}/library/documents/{did}", headers=_user(), timeout=20)
            assert r.status_code == 200
            r2 = s.get(f"{API}/library/documents/{did}", headers=_user(), timeout=20)
            assert r2.status_code == 404


def test_delete_catalog_docs(s):
    for k in ("ficha_id", "hoja_id", "large_id"):
        did = state.get(k)
        if did:
            r = s.delete(f"{API}/catalog/documents/{did}", headers=_admin(), timeout=20)
            assert r.status_code == 200
            r2 = s.get(f"{API}/catalog/documents/{did}", headers=_admin(), timeout=20)
            assert r2.status_code == 404
