"""Preservia backend – Case Sheet (Hoja del caso) feature tests.

Verifies:
- PUT /api/cases/{case_id}/sheet stores case_sheet on the case doc.
- GET /api/cases/{case_id} returns case_sheet.
- GET /api/cases/{case_id}/report returns a valid PDF whose size grows
  when a rich sheet is attached (proxy for the extra section being rendered).
"""
import os
import base64
from pathlib import Path

import pytest
import requests
from pypdf import PdfReader
from io import BytesIO


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


BASE_URL = _load_base_url()
API = f"{BASE_URL}/api"

state = {}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    # Create a case up-front
    r = sess.post(
        f"{API}/cases",
        json={
            "name": "TEST Sheet Case",
            "case_ref": "TEST-SHEET-01",
            "deceased_name": "TEST Deceased Sheet",
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    state["case_id"] = r.json()["case"]["case_id"]
    yield sess
    # Cleanup
    try:
        sess.delete(f"{API}/cases/{state['case_id']}", timeout=15)
    except Exception:
        pass


def test_report_baseline_pdf_size(s):
    """Baseline PDF (no sheet) so we can compare later."""
    r = s.get(f"{API}/cases/{state['case_id']}/report", timeout=40)
    assert r.status_code == 200, r.text
    d = r.json()
    raw = base64.b64decode(d["pdf_base64"])
    assert raw[:4] == b"%PDF"
    reader = PdfReader(BytesIO(raw))
    assert len(reader.pages) >= 1
    state["baseline_size"] = len(raw)
    state["baseline_pages"] = len(reader.pages)


def test_put_case_sheet_saves(s):
    payload = {
        "sheet": {
            "fecha_ingreso": "2026-06-01",
            "no_servicio": "1024",
            "nombre_difunto": "TEST Deceased Sheet",
            "funeraria": "Funeraria Test",
            "responsable_funeraria": "Juan Test",
            "ingreso_sala": "08:00",
            "inicio_emb": "09:00",
            "termino_emb": "11:30",
            "tipo_caso": ["normal"],
            "tipo_caso_otro": "",
            "complexion": "mediana",
            "sello_facial": ["barba"],
            "sello_facial_otro": "",
            "signos": ["ictericia", "gas_tejido"],
            "signos_otros": "otros signos observados",
            "caracteristicas": ["cicatriz", "traumas"],
            "caracteristicas_lesiones": "lesion en brazo derecho",
            "caracteristicas_otros": "",
            "equipo_medico": ["marcapasos"],
            "equipo_medico_otros": "",
            "altura": "175",
            "ancho": "45",
            "peso": "78",
            "tipo_servicio": ["normal"],
            "reacciones": "Ninguna reaccion observada durante el procedimiento",
            "sugerencias": "Mantener refrigeracion a 4C",
            "sala_velacion": "Sala A",
            "domicilio": "",
            "otro_lugar": "",
            "fecha_egreso": "2026-06-02",
            "hora_egreso": "10:00",
            "responsable_entrega": "Pedro Test",
            "titular_responsable": "Dr. Test",
            "tecnico_responsable": "Tec. Test",
            "gerente_turno": "Ger. Test",
        }
    }
    r = s.put(
        f"{API}/cases/{state['case_id']}/sheet",
        json=payload,
        timeout=15,
    )
    assert r.status_code == 200, r.text
    c = r.json()["case"]
    assert "_id" not in c
    assert isinstance(c.get("case_sheet"), dict)
    assert c["case_sheet"]["no_servicio"] == "1024"
    assert c["case_sheet"]["complexion"] == "mediana"
    assert c["case_sheet"]["signos"] == ["ictericia", "gas_tejido"]


def test_get_case_returns_case_sheet(s):
    r = s.get(f"{API}/cases/{state['case_id']}", timeout=15)
    assert r.status_code == 200
    c = r.json()["case"]
    cs = c.get("case_sheet")
    assert isinstance(cs, dict)
    assert cs["funeraria"] == "Funeraria Test"
    assert cs["tipo_caso"] == ["normal"]
    assert cs["altura"] == "175"
    assert cs["tecnico_responsable"] == "Tec. Test"


def test_report_pdf_includes_sheet_section(s):
    """After saving a sheet, PDF should still be valid and larger than baseline."""
    r = s.get(f"{API}/cases/{state['case_id']}/report", timeout=40)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["mime"] == "application/pdf"
    raw = base64.b64decode(d["pdf_base64"])
    assert raw[:4] == b"%PDF"
    reader = PdfReader(BytesIO(raw))
    assert len(reader.pages) >= 1
    # Extract text from all pages and verify our section title + a couple of values render
    text = ""
    for p in reader.pages:
        try:
            text += p.extract_text() or ""
        except Exception:
            pass
    # The section header in PDF is "Analisis del caso - Embalsamamiento"
    assert "Analisis del caso" in text, f"Section header not found in PDF text. Text sample: {text[:400]}"
    # Some values from the sheet should appear
    assert "Funeraria Test" in text
    assert "1024" in text
    assert "Sala A" in text
    # Size should grow vs baseline (proxy)
    assert len(raw) > state["baseline_size"], (
        f"PDF size did not grow: baseline={state['baseline_size']} sheet={len(raw)}"
    )


def test_put_case_sheet_partial_update(s):
    """Sending sheet again should replace it (not merge)."""
    r = s.put(
        f"{API}/cases/{state['case_id']}/sheet",
        json={"sheet": {"funeraria": "Funeraria Actualizada"}},
        timeout=15,
    )
    assert r.status_code == 200
    r2 = s.get(f"{API}/cases/{state['case_id']}", timeout=15)
    cs = r2.json()["case"]["case_sheet"]
    assert cs["funeraria"] == "Funeraria Actualizada"
    # Old keys should be gone (replacement semantics via $set)
    assert "no_servicio" not in cs or cs.get("no_servicio") in (None, "")


def test_put_case_sheet_404_for_unknown_case(s):
    r = s.put(
        f"{API}/cases/does_not_exist_zzz/sheet",
        json={"sheet": {"funeraria": "x"}},
        timeout=15,
    )
    assert r.status_code == 404
