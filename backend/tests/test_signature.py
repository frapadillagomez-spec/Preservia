"""Preservia backend – Firma digital del técnico responsable (case_sheet.firma_tecnico).

Verifies persistence of the signature via PUT /sheet, PDF rendering of the
signature block and robustness of build_pdf against malformed signatures.
"""
import base64
import os
from io import BytesIO
from pathlib import Path

import pytest
import requests
from pypdf import PdfReader


def _load_base_url() -> str:
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if not url:
        for line in Path("/app/frontend/.env").read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                url = line.split("=", 1)[1].strip().strip('"')
                break
    if not url:
        raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not configured")
    return url.rstrip("/")


API = f"{_load_base_url()}/api"
TECH = "TEST_Juan Perez Tecnico"
SIG = {
    "strokes": [[[10, 20], [30, 40], [50, 35], [80, 60]], [[100, 30], [120, 70]], [[140, 50]]],
    "w": 340,
    "h": 320,
    "signed_at": "2026-01-15 10:30",
}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def case_id(s):
    r = s.post(f"{API}/cases", json={"name": "TEST_Firma", "deceased_name": "TEST_Difunto Firma"})
    assert r.status_code == 200, r.text
    cid = r.json()["case"]["case_id"]
    yield cid
    s.delete(f"{API}/cases/{cid}")


def _pdf_text(s, cid) -> str:
    r = s.get(f"{API}/cases/{cid}/report")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "pdf_base64" in data
    raw = base64.b64decode(data["pdf_base64"])
    assert raw[:4] == b"%PDF"
    return "\n".join((p.extract_text() or "") for p in PdfReader(BytesIO(raw)).pages)


# --- Persistence ---
def test_save_sheet_with_signature_persists(s, case_id):
    r = s.put(f"{API}/cases/{case_id}/sheet", json={"sheet": {"tecnico_responsable": TECH, "firma_tecnico": SIG}})
    assert r.status_code == 200, r.text
    g = s.get(f"{API}/cases/{case_id}").json()["case"]
    f = g["case_sheet"]["firma_tecnico"]
    assert len(f["strokes"]) == 3 and len(f["strokes"][0]) == 4
    assert f["w"] > 0 and f["h"] > 0
    assert f["signed_at"] == "2026-01-15 10:30"
    assert g["case_sheet"]["tecnico_responsable"] == TECH


# --- PDF ---
def test_pdf_contains_signature_block(s, case_id):
    s.put(f"{API}/cases/{case_id}/sheet", json={"sheet": {"tecnico_responsable": TECH, "firma_tecnico": SIG}})
    txt = _pdf_text(s, case_id)
    assert "Firma del tecnico responsable" in txt
    assert "2026-01-15 10:30" in txt
    assert txt.count("TEST_Juan Perez Tecnico") >= 2  # row + under signature


def test_pdf_without_signature_has_no_block(s, case_id):
    s.put(f"{API}/cases/{case_id}/sheet", json={"sheet": {"tecnico_responsable": TECH, "peso": "80"}})
    txt = _pdf_text(s, case_id)
    assert "Firma del tecnico responsable" not in txt
    assert TECH in txt


def test_pdf_signature_without_technician_name(s, case_id):
    s.put(f"{API}/cases/{case_id}/sheet", json={"sheet": {"peso": "70", "firma_tecnico": SIG}})
    txt = _pdf_text(s, case_id)
    assert "Firma del tecnico responsable" in txt


MALFORMED = [
    {"strokes": [], "w": 300, "h": 200, "signed_at": "x"},
    {"strokes": "garbage"},
    "garbage",
    123,
    None,
    [],
    {"strokes": [[]]},
    {"strokes": [[[1, 2, 3]]], "w": 100, "h": 100},
    {"strokes": [[["a", "b"]]]},
    {"strokes": [[{"x": 1}]]},
    {"strokes": [[[5, 5]]], "w": 0, "h": 0},
    {"strokes": [[[5, 5], [5, 5]]], "w": -1, "h": "abc"},
    {"strokes": [[[1, 2]], "ab"], "w": 10, "h": 10},
    {"strokes": [[[1e300, 1e300], [-1e300, -1e300]]], "w": 10, "h": 10},
    {"strokes": [[[1, 2], [3, 4]]], "signed_at": None},
    {"strokes": [[[1, 2], [3, 4]]], "signed_at": "<b>&</b>"},
]


# --- Robustness: malformed signatures must not break PDF ---
@pytest.mark.parametrize("bad", MALFORMED, ids=[str(i) for i in range(len(MALFORMED))])
def test_pdf_malformed_signature(s, case_id, bad):
    r = s.put(f"{API}/cases/{case_id}/sheet", json={"sheet": {"tecnico_responsable": TECH, "firma_tecnico": bad}})
    assert r.status_code == 200, r.text
    r = s.get(f"{API}/cases/{case_id}/report")
    assert r.status_code == 200, f"report failed for {bad!r}: {r.status_code} {r.text[:200]}"
    assert base64.b64decode(r.json()["pdf_base64"])[:4] == b"%PDF"


def test_pdf_nan_signature(s, case_id):
    body = '{"sheet": {"tecnico_responsable": "TEST_x", "firma_tecnico": {"strokes": [[[NaN, 1], [2, Infinity]]], "w": 10, "h": 10}}}'
    r = s.put(f"{API}/cases/{case_id}/sheet", data=body)
    if r.status_code != 200:
        pytest.skip(f"NaN payload rejected at input ({r.status_code})")
    r = s.get(f"{API}/cases/{case_id}/report")
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
