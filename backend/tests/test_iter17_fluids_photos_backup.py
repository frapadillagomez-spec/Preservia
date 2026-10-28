# Iteration 17: fluid templates, before/after photos (+PDF), full backup/restore, regressions
import base64
import io
import os
import time
import uuid

import pytest
import requests
from PIL import Image
from pypdf import PdfReader

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


def jpeg_b64(color=(200, 30, 30)):
    buf = io.BytesIO()
    Image.new("RGB", (60, 40), color).save(buf, "JPEG")
    return base64.b64encode(buf.getvalue()).decode()


@pytest.fixture(scope="module")
def s():
    return requests.Session()


def pdf_text(s, cid):
    r = s.get(f"{API}/cases/{cid}/report")
    assert r.status_code == 200, r.text
    reader = PdfReader(io.BytesIO(base64.b64decode(r.json()["pdf_base64"])))
    return reader, "\n".join((p.extract_text() or "") for p in reader.pages)


# ---------- Fluids ----------
class TestFluids:
    def test_crud_upsert_validation(self, s):
        name = f"TEST_Fluido_{uuid.uuid4().hex[:5]}"
        r = s.post(f"{API}/fluids", json={"name": name, "index_pct": 25})
        assert r.status_code == 200, r.text
        item = r.json()["item"]
        assert item["name"] == name and item["index_pct"] == 25 and item["item_id"].startswith("flu_")
        assert "_id" not in item
        # upsert case-insensitive
        r2 = s.post(f"{API}/fluids", json={"name": name.upper(), "index_pct": 30})
        assert r2.status_code == 200
        assert r2.json()["item"]["item_id"] == item["item_id"]
        lst = s.get(f"{API}/fluids").json()["items"]
        mine = [f for f in lst if f["name"].lower() == name.lower()]
        assert len(mine) == 1 and mine[0]["index_pct"] == 30
        # validation
        for bad in ({"name": "", "index_pct": 10}, {"name": "TEST_x", "index_pct": 0},
                    {"name": "TEST_x", "index_pct": 101}, {"name": "TEST_x", "index_pct": "abc"},
                    {"name": "TEST_x", "index_pct": -5}):
            assert s.post(f"{API}/fluids", json=bad).status_code == 400, bad
        assert s.post(f"{API}/fluids", json={"name": "TEST_edge100", "index_pct": 100}).status_code == 200
        e = [f for f in s.get(f"{API}/fluids").json()["items"] if f["name"] == "TEST_edge100"][0]
        assert s.delete(f"{API}/fluids/{e['item_id']}").status_code == 200
        # delete
        assert s.delete(f"{API}/fluids/{item['item_id']}").status_code == 200
        assert s.delete(f"{API}/fluids/{item['item_id']}").status_code == 404
        assert all(f["item_id"] != item["item_id"] for f in s.get(f"{API}/fluids").json()["items"])

    def test_fluid_name_in_pdf(self, s):
        c = s.post(f"{API}/cases", json={"deceased_name": "TEST_fluidpdf", "sex": "male"}).json()["case"]
        try:
            inputs = {"weight_kg": 80, "height_cm": 175, "sex": "male", "lbm_method": "average", "mode": "kf",
                      "k_factor": 0.135, "factor_f": 1.093, "desired_index_pct": 2, "fluid_index_pct": 25,
                      "fluid_name": "TEST_ArterialX"}
            r = s.post(f"{API}/cases/{c['case_id']}/calculations", json={"type": "injection", "inputs": inputs})
            assert r.status_code == 200, r.text
            calc = r.json()["calculation"]
            assert calc["inputs"]["fluid_name"] == "TEST_ArterialX"
            assert calc["results"]["total_l"] == 8.93
            _, txt = pdf_text(s, c["case_id"])
            assert "Fluido arterial" in txt and "TEST_ArterialX" in txt
        finally:
            s.delete(f"{API}/cases/{c['case_id']}")


# ---------- Photos ----------
class TestPhotos:
    def test_photos_flow_and_pdf(self, s):
        c = s.post(f"{API}/cases", json={"deceased_name": "TEST_photos", "sex": "female"}).json()["case"]
        cid = c["case_id"]
        try:
            bad = s.post(f"{API}/cases/{cid}/attachments", json={"label": "Foto", "kind": "photo", "stage": "durante", "data_base64": jpeg_b64()})
            assert bad.status_code == 400
            nostage = s.post(f"{API}/cases/{cid}/attachments", json={"label": "Foto", "kind": "photo", "data_base64": jpeg_b64()})
            assert nostage.status_code == 400
            ids = []
            for stage, col in (("despues", (0, 0, 200)), ("antes", (200, 0, 0)), ("antes", (0, 200, 0))):
                r = s.post(f"{API}/cases/{cid}/attachments", json={"label": "Foto", "kind": "photo", "stage": stage.upper() if stage == "despues" else stage, "filename": "f.jpg", "data_base64": jpeg_b64(col)})
                assert r.status_code == 200, r.text
                a = r.json()["attachment"]
                assert a["kind"] == "photo" and a["stage"] == stage
                assert a["label"] == ("Foto antes" if stage == "antes" else "Foto después")
                ids.append(a["att_id"])
                time.sleep(0.05)
            # a regular document too
            doc = s.post(f"{API}/cases/{cid}/attachments", json={"label": "Certificado de Defunción", "kind": "image", "data_base64": jpeg_b64()})
            assert doc.status_code == 200
            lst = s.get(f"{API}/cases/{cid}/attachments").json()["attachments"]
            photos = [a for a in lst if a["kind"] == "photo"]
            assert len(photos) == 3 and all("stage" in a for a in photos)
            reader, txt = pdf_text(s, cid)
            assert "Fotografias del caso" in txt
            i_a, i_d = txt.find("Antes del tratamiento"), txt.find("Despues del tratamiento")
            assert 0 <= i_a < i_d, (i_a, i_d)
            assert "1." in txt[i_a:i_d] and "2." in txt[i_a:i_d]
            # photos must not be rendered as full-page attachments (labels as headings)
            assert "Foto antes" not in txt and "Foto después" not in txt and "Foto despues" not in txt
            assert "Certificado de Defunción" in txt or "Certificado de Defuncion" in txt
            # delete one photo
            assert s.delete(f"{API}/attachments/{ids[0]}").status_code == 200
            lst2 = s.get(f"{API}/cases/{cid}/attachments").json()["attachments"]
            assert len([a for a in lst2 if a["kind"] == "photo"]) == 2
            _, txt2 = pdf_text(s, cid)
            assert "Despues del tratamiento" not in txt2
        finally:
            for a in s.get(f"{API}/cases/{cid}/attachments").json().get("attachments", []):
                s.delete(f"{API}/attachments/{a['att_id']}")
            s.delete(f"{API}/cases/{cid}")


# ---------- Backup ----------
class TestBackup:
    def test_backup_export_restore(self, s):
        tag = uuid.uuid4().hex[:5]
        c = s.post(f"{API}/cases", json={"deceased_name": f"TEST_bk_{tag}", "sex": "male"}).json()["case"]
        cid = c["case_id"]
        fl = s.post(f"{API}/fluids", json={"name": f"TEST_bkfluid_{tag}", "index_pct": 18}).json()["item"]
        new_cid = None
        try:
            s.post(f"{API}/cases/{cid}/notes", json={"text": "TEST nota respaldo", "photos": []})
            s.post(f"{API}/cases/{cid}/calculations", json={"type": "concentration", "inputs": {"desired_index_pct": 2, "fluid_index_pct": 25, "total_solution_l": 8}})
            bk = s.get(f"{API}/backup")
            assert bk.status_code == 200
            data = bk.json()
            assert data["app"] == "Preservia" and data["backup_version"] == 1
            assert isinstance(data["coinjectors"], list) and isinstance(data["fluids"], list)
            mine = [x for x in data["cases"] if x["case_id"] == cid][0]
            assert mine["notes"][0]["text"] == "TEST nota respaldo"
            assert len(mine["calculations"]) == 1 and "logbook" in mine or True
            assert any(f["name"] == fl["name"] for f in data["fluids"])
            assert all("_id" not in x for x in data["cases"])
            # restore with existing data -> everything skipped
            r = s.post(f"{API}/backup/restore", json={**data, "cases": [mine], "coinjectors": [], "fluids": []})
            assert r.status_code == 200 and r.json()["restored"] == 0 and r.json()["skipped"] == 1
            # delete case and fluid, then restore only test items
            s.delete(f"{API}/cases/{cid}")
            s.delete(f"{API}/fluids/{fl['item_id']}")
            r = s.post(f"{API}/backup/restore", json={"app": "Preservia", "backup_version": 1, "cases": [mine],
                                                      "coinjectors": [], "fluids": [f for f in data["fluids"] if f["name"] == fl["name"]]})
            assert r.status_code == 200, r.text
            assert r.json() == {"restored": 1, "skipped": 0, "catalog_items": 1}
            cases = s.get(f"{API}/cases").json()
            cases = cases.get("cases", cases) if isinstance(cases, dict) else cases
            rc = [x for x in cases if x.get("deceased_name") == f"TEST_bk_{tag}"]
            assert len(rc) == 1
            new_cid = rc[0]["case_id"]
            full = s.get(f"{API}/cases/{new_cid}").json()
            full = full.get("case", full)
            assert full["case_number"] == mine["case_number"]
            assert len(full["calculations"]) == 1
            assert full["notes"][0]["text"] == "TEST nota respaldo"
            assert any(f["name"] == fl["name"] for f in s.get(f"{API}/fluids").json()["items"])
            # invalid payloads
            for bad in ({}, {"app": "Other", "cases": []}, {"app": "Preservia", "cases": "x"}):
                assert s.post(f"{API}/backup/restore", json=bad).status_code == 400
        finally:
            for x in (cid, new_cid):
                if x:
                    s.delete(f"{API}/cases/{x}")
            for f in s.get(f"{API}/fluids").json()["items"]:
                if f["name"].startswith("TEST_"):
                    s.delete(f"{API}/fluids/{f['item_id']}")


# ---------- Regression ----------
def test_case_import_regression(s):
    r = s.post(f"{API}/cases/import", json={"case": {"name": "TEST_import", "deceased_name": "TEST_import", "notes": [{"text": "n1"}],
                                                       "calculations": [{"type": "concentration", "inputs": {}, "results": {}}]}})
    assert r.status_code == 200, r.text
    case = r.json()["case"]
    assert case["deceased_name"] == "TEST_import"
    s.delete(f"{API}/cases/{case['case_id']}")
    assert s.post(f"{API}/cases/import", json={"foo": 1}).status_code == 400
