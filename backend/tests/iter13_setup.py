# Iteration 13 helper: create / modify / inspect / cleanup TEST_ cases for offline conflict UI tests
import sys, json, os, requests
from pathlib import Path

url = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
if not url:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            url = line.split("=", 1)[1].strip().strip('"')
API = url.rstrip("/") + "/api"
cmd = sys.argv[1]
if cmd == "create":
    name = sys.argv[2]
    conds = sys.argv[3].split(",") if len(sys.argv) > 3 else ["rutinario"]
    c = requests.post(f"{API}/cases", json={"deceased_name": name, "sex": "male"}).json()["case"]
    r = requests.put(f"{API}/cases/{c['case_id']}/sheet", json={"sheet": {"condicion_general": "rutinario", "condiciones": conds, "peso": "80", "altura": "175", "gerente_turno": "ORIGINAL"}})
    g = requests.get(f"{API}/cases/{c['case_id']}").json()["case"]
    print(json.dumps({"case_id": c["case_id"], "updated_at": g["updated_at"], "kf": g.get("kf_summary")}))
elif cmd == "server_edit":
    cid = sys.argv[2]
    g = requests.get(f"{API}/cases/{cid}").json()["case"]
    sheet = g.get("case_sheet") or {}
    sheet["gerente_turno"] = "SERVER_EDIT"
    r = requests.put(f"{API}/cases/{cid}/sheet", json={"sheet": sheet})
    print(r.status_code, requests.get(f"{API}/cases/{cid}").json()["case"]["updated_at"])
elif cmd == "get":
    g = requests.get(f"{API}/cases/{sys.argv[2]}").json()["case"]
    print(json.dumps({"updated_at": g["updated_at"], "gerente": (g.get("case_sheet") or {}).get("gerente_turno"),
                      "notes": [n.get("text") for n in g.get("notes", [])], "calcs": len(g.get("calculations", []))}))
elif cmd == "cleanup":
    cases = requests.get(f"{API}/cases").json().get("cases", [])
    n = 0
    for c in cases:
        if (c.get("deceased_name") or "").startswith("TEST_"):
            requests.delete(f"{API}/cases/{c['case_id']}"); n += 1
    print("deleted", n)
