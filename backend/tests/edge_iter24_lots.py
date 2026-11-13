# Edge probes iter24: zombie lots, deleted-lot refund target, unit mismatch, empty lot accepted, invalid mix lot_id
import os, uuid, requests
API = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
T = uuid.uuid4().hex[:5]
fl, cs = [], []
try:
    f = requests.post(f"{API}/fluids", json={"name": f"TEST_edge_{T}", "kind": "cavidad", "bottle_ml": 473, "stock_bottles": 2, "lot": "E-1"}).json()["item"]
    fl.append(f["item_id"])
    c = requests.post(f"{API}/cases", json={"deceased_name": f"TEST_edge_{T}", "sex": "male"}).json()["case"]
    cs.append(c["case_id"])
    cid = c["case_id"]
    # 1. typed new lot with fluid_id -> zombie lot?
    e = requests.post(f"{API}/cases/{cid}/logbook", json={"product": f["name"], "form": "liquid", "quantity": 100, "unit": "ml", "category": "cavidad", "lot": "TYPO-9", "fluid_id": f["item_id"]}).json()["entry"]
    lots = next(x for x in requests.get(f"{API}/fluids").json()["items"] if x["item_id"] == f["item_id"])["lots"]
    print("1. typed lot entry deducted:", e.get("deducted"), "lots now:", [(l["lot"], l["stock"]) for l in lots])
    # 2. deleted lot then delete entry
    lb = requests.post(f"{API}/fluids/{f['item_id']}/lots", json={"lot": "E-2", "stock": 1}).json()["lot_id"]
    e2 = requests.post(f"{API}/cases/{cid}/logbook", json={"product": f["name"], "form": "liquid", "quantity": 236.5, "unit": "ml", "category": "cavidad", "lot": "E-2", "fluid_id": f["item_id"], "lot_id": lb}).json()["entry"]
    requests.delete(f"{API}/fluids/{f['item_id']}/lots/{lb}")
    requests.delete(f"{API}/cases/{cid}/logbook/{e2['log_id']}")
    lots = next(x for x in requests.get(f"{API}/fluids").json()["items"] if x["item_id"] == f["item_id"])["lots"]
    print("2. after deleting lot E-2 then entry, refund went to:", [(l["lot"], l["stock"]) for l in lots])
    # 3. topico product created with unit ml, logged in g
    t = requests.post(f"{API}/fluids", json={"name": f"TEST_edgeTop_{T}", "kind": "topico", "bottle_ml": 100, "stock_bottles": 2, "lot": "T-1"}).json()["item"]
    fl.append(t["item_id"])
    e3 = requests.post(f"{API}/cases/{cid}/logbook", json={"product": t["name"], "form": "powder", "quantity": 50, "unit": "g", "category": "topico", "lot": "T-1", "fluid_id": t["item_id"], "lot_id": t["lots"][0]["lot_id"]}).json()["entry"]
    print("3. topico unit=", t.get("unit"), "deducted:", e3.get("deducted"))
    # 4. empty lot accepted by backend?
    r = requests.post(f"{API}/cases/{cid}/logbook", json={"product": "TEST_nolot", "form": "liquid", "quantity": 1, "unit": "ml", "category": "putrefacto", "lot": ""})
    print("4. empty lot status:", r.status_code)
    # 5. negative / huge lot stock via PATCH set
    r = requests.patch(f"{API}/fluids/{f['item_id']}/lots/{lots[0]['lot_id']}", json={"set": -5})
    print("5. set -5 ->", r.json().get("stock_lot"))
    r = requests.patch(f"{API}/fluids/{f['item_id']}/lots/{lots[0]['lot_id']}", json={"delta": "abc"})
    print("5b. delta abc ->", r.status_code)
    # 6. lot name duplicate add
    r1 = requests.post(f"{API}/fluids/{f['item_id']}/lots", json={"lot": "e-1", "stock": 1}).json()
    print("6. duplicate lot name 'e-1' merged into:", r1.get("lot"), r1.get("stock_lot"))
    # 7. purchase without lot
    p = requests.post(f"{API}/purchases", json={"fluid_id": f["item_id"], "bottles": 1, "total": 10}).json()
    print("7. purchase no lot ->", p["purchase"]["lot"])
    requests.delete(f"{API}/purchases/{p['purchase']['purchase_id']}")
    # 8. supplier duplicate / 404 delete lot on unknown fluid
    print("8. delete lot unknown fluid:", requests.delete(f"{API}/fluids/flu_nope/lots/lot_x").status_code,
          "delete unknown lot id:", requests.delete(f"{API}/fluids/{f['item_id']}/lots/lot_nope").status_code)
    # 9. embalming restart clears end
    requests.post(f"{API}/cases/{cid}/embalming", json={"action": "start"})
    requests.post(f"{API}/cases/{cid}/embalming", json={"action": "stop"})
    cc = requests.post(f"{API}/cases/{cid}/embalming", json={"action": "start"}).json()["case"]
    print("9. restart -> end:", cc.get("embalming_end"), "termino:", repr(cc["case_sheet"].get("termino_emb")))
finally:
    for c in cs: requests.delete(f"{API}/cases/{c}")
    for x in fl: requests.delete(f"{API}/fluids/{x}")
