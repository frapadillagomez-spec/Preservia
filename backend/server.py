import os
import uuid
import logging
import base64
from io import BytesIO
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Any, Dict

import jwt
import httpx
import bcrypt
from bson import ObjectId
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from pydantic import BaseModel, Field, EmailStr

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage,
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]
fs = AsyncIOMotorGridFSBucket(db, bucket_name="pdfs")

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGO = "HS256"
JWT_EXPIRE_DAYS = 30
EMERGENT_SESSION_API = os.environ["EMERGENT_SESSION_API"]
ADMIN_EMAILS = {
    e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("preservia")

app = FastAPI(title="Preservia API")
api_router = APIRouter(prefix="/api")


# ----------------------------- Models -----------------------------
class RegisterInput(BaseModel):
    email: EmailStr
    password: str
    name: str


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class GoogleInput(BaseModel):
    session_id: str


class CaseInput(BaseModel):
    name: str
    case_ref: Optional[str] = ""
    deceased_name: Optional[str] = ""
    date: Optional[str] = None
    status: Optional[str] = "active"


class CalcRequest(BaseModel):
    type: str  # volume | lbm | concentration
    inputs: Dict[str, Any]


class NoteInput(BaseModel):
    text: str
    date: Optional[str] = None
    photos: List[str] = Field(default_factory=list)  # base64 data


class DocumentInput(BaseModel):
    title: str
    filename: str
    pdf_base64: str


class CatalogInput(BaseModel):
    category: str  # ficha_tecnica | hoja_seguridad
    title: str
    filename: str
    pdf_base64: str


# ----------------------------- Helpers -----------------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def public_user(u: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "user_id": u["user_id"],
        "email": u["email"],
        "name": u.get("name", ""),
        "picture": u.get("picture", ""),
        "provider": u.get("provider", "email"),
        "is_admin": u.get("email", "").lower() in ADMIN_EMAILS,
    }


async def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="No autenticado")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sesión expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")
    user = await db.users.find_one({"user_id": payload.get("sub")}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no encontrado")
    return user


async def get_current_admin(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if user.get("email", "").lower() not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Requiere permisos de administrador")
    return user


# --------------- PDF storage helpers (GridFS, supports large files) ---------------
async def store_pdf(pdf_base64: str, filename: str) -> tuple[str, int]:
    try:
        raw = base64.b64decode(pdf_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="PDF invalido")
    if not raw:
        raise HTTPException(status_code=400, detail="El archivo esta vacio")
    grid_id = await fs.upload_from_stream(filename, raw)
    return str(grid_id), len(raw)


async def load_pdf_b64(doc: Dict[str, Any]) -> str:
    if doc.get("pdf_base64"):
        return doc["pdf_base64"]
    gid = doc.get("grid_id")
    if not gid:
        return ""
    grid_out = await fs.open_download_stream(ObjectId(gid))
    data = await grid_out.read()
    return base64.b64encode(data).decode("utf-8")


async def delete_pdf(doc: Dict[str, Any]) -> None:
    gid = doc.get("grid_id")
    if gid:
        try:
            await fs.delete(ObjectId(gid))
        except Exception:
            pass


# ----------------------------- Calculations -----------------------------
def compute(calc_type: str, inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Standard thanatopraxy formulas. Returns {results, summary}."""
    try:
        if calc_type == "volume":
            weight_kg = float(inputs["weight_kg"])
            case_type = str(inputs.get("case_type", "normal")).lower()
            basis = str(inputs.get("basis", "total")).lower()
            # Effective weight used for the solution estimate. Lean body mass
            # gives a more accurate requirement since fat tissue is less vascular.
            lbm_kg = None
            if basis == "lean":
                sex = str(inputs.get("sex", "male")).lower()
                height_cm = float(inputs["height_cm"])
                if sex.startswith("f"):
                    lbm_kg = 0.252 * weight_kg + 0.473 * height_cm - 48.3
                else:
                    lbm_kg = 0.407 * weight_kg + 0.267 * height_cm - 19.2
                effective_kg = max(lbm_kg, 0)
            else:
                effective_kg = weight_kg
            factors = {"normal": 1.0, "jaundice": 1.15, "edema": 0.85}
            factor = factors.get(case_type, 1.0)
            labels = {"normal": "Normal", "jaundice": "Ictericia", "edema": "Edema"}
            effective_lb = effective_kg * 2.20462
            gallons = (effective_lb / 50.0) * factor
            liters = gallons * 3.78541
            results = {
                "liters": round(liters, 2),
                "gallons": round(gallons, 2),
                "weight_kg": round(weight_kg, 1),
                "case_type": labels.get(case_type, "Normal"),
                "adjustment": f"x{factor}",
                "basis": "Masa magra" if basis == "lean" else "Peso total",
            }
            if lbm_kg is not None:
                results["lbm_kg"] = round(lbm_kg, 1)
            basis_txt = f" (masa magra {results.get('lbm_kg')} kg)" if lbm_kg is not None else ""
            summary = (
                f"{results['liters']} L de solucion arterial (~{results['gallons']} gal) "
                f"- {results['case_type']}{basis_txt}"
            )
            return {"results": results, "summary": summary}

        if calc_type == "lbm":
            sex = str(inputs.get("sex", "male")).lower()
            weight_kg = float(inputs["weight_kg"])
            height_cm = float(inputs["height_cm"])
            if sex.startswith("f"):
                lbm = 0.252 * weight_kg + 0.473 * height_cm - 48.3
            else:
                lbm = 0.407 * weight_kg + 0.267 * height_cm - 19.2
            fat_kg = max(weight_kg - lbm, 0)
            results = {
                "lbm_kg": round(lbm, 1),
                "fat_kg": round(fat_kg, 1),
                "fat_pct": round((fat_kg / weight_kg) * 100, 1) if weight_kg else 0,
            }
            summary = f"Masa magra: {results['lbm_kg']} kg"
            return {"results": results, "summary": summary}

        if calc_type == "injection":
            # Injection-volume calc based on C1·V1 = C2·V2.
            # V1 = concentrate volume (default 473 mL = 16 fl oz commercial bottle, editable),
            # C1 = stock fluid index, C2 = desired index -> V2 = C1·V1 / C2 (total solution).
            # Lean body mass provides a recommended reference volume (~1 gal / 50 lb).
            weight_kg = float(inputs["weight_kg"])
            height_cm = float(inputs["height_cm"])
            sex = str(inputs.get("sex", "male")).lower()
            case_type = str(inputs.get("case_type", "normal")).lower()
            c1 = float(inputs["fluid_index_pct"])
            c2 = float(inputs["desired_index_pct"])
            concentrate_ml = float(inputs.get("concentrate_ml", 473.0))
            if c1 <= 0:
                raise ValueError("El indice del fluido debe ser mayor que 0")
            if c2 <= 0:
                raise ValueError("El indice deseado debe ser mayor que 0")
            if c2 > c1:
                raise ValueError("El indice deseado no puede superar el indice del fluido")
            if concentrate_ml <= 0:
                raise ValueError("El volumen de concentrado (V1) debe ser mayor que 0")
            if sex.startswith("f"):
                lbm = 0.252 * weight_kg + 0.473 * height_cm - 48.3
            else:
                lbm = 0.407 * weight_kg + 0.267 * height_cm - 19.2
            lbm = max(lbm, 0)
            factors = {"normal": 1.0, "jaundice": 1.15, "edema": 0.85}
            factor = factors.get(case_type, 1.0)
            labels = {"normal": "Normal", "jaundice": "Ictericia", "edema": "Edema"}
            # C1·V1 = C2·V2  ->  V2 = C1·V1 / C2, adjusted by case-type factor
            base_total_ml = (c1 * concentrate_ml) / c2
            total_ml = base_total_ml * factor
            water_ml = max(total_ml - concentrate_ml, 0)
            # Case-type factor adjusts the volume the body needs (lean-mass reference)
            recommended_ml = (lbm * 2.20462 / 50.0) * 3785.41 * factor
            v2_per_bottle_ml = (c1 * 473.0) / c2
            recommended_bottles = recommended_ml / v2_per_bottle_ml if v2_per_bottle_ml > 0 else 0
            bottles = concentrate_ml / 473.0
            # Composition of the injected solution: the formaldehyde comes from the
            # concentrate (C1% of V1); the rest of V2 is water.
            formaldehyde_ml = (c1 / 100.0) * concentrate_ml
            water_injection_ml = max(total_ml - formaldehyde_ml, 0)
            results = {
                "lbm_kg": round(lbm, 1),
                "total_l": round(total_ml / 1000.0, 2),
                "total_ml": round(total_ml, 0),
                "concentrate_ml": round(concentrate_ml, 0),
                "water_ml": round(water_ml, 0),
                "formaldehyde_ml": round(formaldehyde_ml, 0),
                "water_injection_ml": round(water_injection_ml, 0),
                "bottles": round(bottles, 2),
                "recommended_l": round(recommended_ml / 1000.0, 2),
                "recommended_bottles": round(recommended_bottles, 1),
                "desired_index_pct": c2,
                "fluid_index_pct": c1,
                "case_type": labels.get(case_type, "Normal"),
                "adjustment": f"x{factor}",
            }
            summary = (
                f"V2 = {results['total_l']} L: formaldehido {results['formaldehyde_ml']:.0f} mL + "
                f"agua {results['water_injection_ml']:.0f} mL - {results['case_type']} (x{factor})"
            )
            return {"results": results, "summary": summary}

        if calc_type == "concentration":
            total_l = float(inputs["total_solution_l"])
            desired = float(inputs["desired_index_pct"])
            fluid_index = float(inputs["fluid_index_pct"])
            if fluid_index <= 0:
                raise ValueError("El indice del fluido debe ser mayor que 0")
            concentrate_ml = (desired / fluid_index) * total_l * 1000.0
            total_ml = total_l * 1000.0
            water_ml = max(total_ml - concentrate_ml, 0)
            results = {
                "concentrate_ml": round(concentrate_ml, 0),
                "water_ml": round(water_ml, 0),
                "total_ml": round(total_ml, 0),
            }
            summary = f"{results['concentrate_ml']:.0f} mL concentrado + {results['water_ml']:.0f} mL agua"
            return {"results": results, "summary": summary}
    except (KeyError, ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=f"Datos de calculo invalidos: {e}")

    raise HTTPException(status_code=400, detail="Tipo de calculo desconocido")


CALC_LABELS = {
    "volume": "Volumen de solucion",
    "lbm": "Masa magra corporal",
    "concentration": "Concentracion / Dilucion",
    "injection": "Volumen de inyeccion",
}


# ----------------------------- Auth routes -----------------------------
@api_router.post("/auth/register")
async def register(data: RegisterInput):
    existing = await db.users.find_one({"email": data.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="El correo ya esta registrado")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user = {
        "user_id": user_id,
        "email": data.email.lower(),
        "name": data.name,
        "password_hash": hash_password(data.password),
        "provider": "email",
        "picture": "",
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    return {"access_token": create_token(user_id), "user": public_user(user)}


@api_router.post("/auth/login")
async def login(data: LoginInput):
    user = await db.users.find_one({"email": data.email.lower()})
    if not user or not user.get("password_hash") or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenciales invalidas")
    return {"access_token": create_token(user["user_id"]), "user": public_user(user)}


@api_router.post("/auth/google")
async def google_auth(data: GoogleInput):
    async with httpx.AsyncClient(timeout=20) as http:
        resp = await http.get(EMERGENT_SESSION_API, headers={"X-Session-ID": data.session_id})
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Sesion de Google invalida")
    info = resp.json()
    email = info["email"].lower()
    user = await db.users.find_one({"email": email})
    if not user:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": user_id,
            "email": email,
            "name": info.get("name", ""),
            "picture": info.get("picture", ""),
            "provider": "google",
            "password_hash": None,
            "created_at": now_iso(),
        }
        await db.users.insert_one(user)
    else:
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"picture": info.get("picture", user.get("picture", ""))}},
        )
    return {"access_token": create_token(user["user_id"]), "user": public_user(user)}


@api_router.get("/auth/me")
async def me(user: Dict[str, Any] = Depends(get_current_user)):
    return {"user": public_user(user)}


# ----------------------------- Calculate (stateless) -----------------------------
@api_router.post("/calculate")
async def calculate(req: CalcRequest, user: Dict[str, Any] = Depends(get_current_user)):
    return compute(req.type, req.inputs)


# ----------------------------- Cases -----------------------------
def case_public(c: Dict[str, Any]) -> Dict[str, Any]:
    c.pop("_id", None)
    return c


@api_router.get("/cases")
async def list_cases(user: Dict[str, Any] = Depends(get_current_user)):
    cases = await db.cases.find({"user_id": user["user_id"]}, {"_id": 0}).sort("updated_at", -1).to_list(500)
    for c in cases:
        c["calc_count"] = len(c.get("calculations", []))
        c["note_count"] = await db.notes.count_documents({"case_id": c["case_id"]})
        c.pop("calculations", None)
    return {"cases": cases}


@api_router.post("/cases")
async def create_case(data: CaseInput, user: Dict[str, Any] = Depends(get_current_user)):
    case_id = f"case_{uuid.uuid4().hex[:12]}"
    doc = {
        "case_id": case_id,
        "user_id": user["user_id"],
        "name": data.name,
        "case_ref": data.case_ref or "",
        "deceased_name": data.deceased_name or "",
        "date": data.date or now_iso(),
        "status": data.status or "active",
        "calculations": [],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.cases.insert_one(doc)
    return {"case": case_public(dict(doc))}


@api_router.get("/cases/{case_id}")
async def get_case(case_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    notes = await db.notes.find({"case_id": case_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    c["notes"] = notes
    return {"case": c}


@api_router.put("/cases/{case_id}")
async def update_case(case_id: str, data: CaseInput, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    await db.cases.update_one(
        {"case_id": case_id},
        {"$set": {
            "name": data.name,
            "case_ref": data.case_ref or "",
            "deceased_name": data.deceased_name or "",
            "status": data.status or c.get("status", "active"),
            "updated_at": now_iso(),
        }},
    )
    updated = await db.cases.find_one({"case_id": case_id}, {"_id": 0})
    return {"case": updated}


@api_router.delete("/cases/{case_id}")
async def delete_case(case_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    await db.cases.delete_one({"case_id": case_id})
    await db.notes.delete_many({"case_id": case_id})
    return {"ok": True}


# ----------------------------- Calculations on a case -----------------------------
@api_router.post("/cases/{case_id}/calculations")
async def add_calculation(case_id: str, req: CalcRequest, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    computed = compute(req.type, req.inputs)
    calc = {
        "calc_id": f"calc_{uuid.uuid4().hex[:10]}",
        "type": req.type,
        "label": CALC_LABELS.get(req.type, req.type),
        "inputs": req.inputs,
        "results": computed["results"],
        "summary": computed["summary"],
        "created_at": now_iso(),
    }
    await db.cases.update_one(
        {"case_id": case_id},
        {"$push": {"calculations": calc}, "$set": {"updated_at": now_iso()}},
    )
    return {"calculation": calc}


@api_router.delete("/cases/{case_id}/calculations/{calc_id}")
async def delete_calculation(case_id: str, calc_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    await db.cases.update_one(
        {"case_id": case_id},
        {"$pull": {"calculations": {"calc_id": calc_id}}, "$set": {"updated_at": now_iso()}},
    )
    return {"ok": True}


# ----------------------------- Notes -----------------------------
@api_router.post("/cases/{case_id}/notes")
async def add_note(case_id: str, data: NoteInput, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    note = {
        "note_id": f"note_{uuid.uuid4().hex[:10]}",
        "case_id": case_id,
        "user_id": user["user_id"],
        "text": data.text,
        "date": data.date or now_iso(),
        "photos": data.photos,
        "created_at": now_iso(),
    }
    await db.notes.insert_one(dict(note))
    await db.cases.update_one({"case_id": case_id}, {"$set": {"updated_at": now_iso()}})
    return {"note": note}


@api_router.delete("/notes/{note_id}")
async def delete_note(note_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    n = await db.notes.find_one({"note_id": note_id, "user_id": user["user_id"]})
    if not n:
        raise HTTPException(status_code=404, detail="Nota no encontrada")
    await db.notes.delete_one({"note_id": note_id})
    return {"ok": True}


# ----------------------------- PDF Report -----------------------------
def build_pdf(case: Dict[str, Any], notes: List[Dict[str, Any]], user: Dict[str, Any]) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=20 * mm, bottomMargin=18 * mm,
    )
    styles = getSampleStyleSheet()
    slate = colors.HexColor("#334155")
    slate_light = colors.HexColor("#64748B")
    ink = colors.HexColor("#0F172A")

    title = ParagraphStyle("PTitle", parent=styles["Title"], textColor=ink, fontSize=22, spaceAfter=2)
    subtitle = ParagraphStyle("PSub", parent=styles["Normal"], textColor=slate_light, fontSize=10, spaceAfter=14)
    h2 = ParagraphStyle("PH2", parent=styles["Heading2"], textColor=slate, fontSize=13, spaceBefore=14, spaceAfter=6)
    body = ParagraphStyle("PBody", parent=styles["Normal"], textColor=ink, fontSize=10, leading=15)
    small = ParagraphStyle("PSmall", parent=styles["Normal"], textColor=slate_light, fontSize=8.5)

    def fmt_date(iso: Optional[str]) -> str:
        if not iso:
            return "-"
        try:
            return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%d/%m/%Y %H:%M")
        except Exception:
            return iso

    elems: List[Any] = []
    elems.append(Paragraph("PRESERVIA", title))
    elems.append(Paragraph("Reporte profesional de caso - Tanatopraxia", subtitle))

    info_rows = [
        ["Caso", case.get("name", "-")],
        ["ID / Referencia", case.get("case_ref") or "-"],
        ["Fallecido", case.get("deceased_name") or "-"],
        ["Fecha del caso", fmt_date(case.get("date"))],
        ["Profesional", f"{user.get('name','')} ({user.get('email','')})"],
        ["Generado", fmt_date(now_iso())],
    ]
    t = Table(info_rows, colWidths=[45 * mm, 120 * mm])
    t.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), slate_light),
        ("TEXTCOLOR", (1, 0), (1, -1), ink),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#E2E8F0")),
    ]))
    elems.append(t)

    elems.append(Paragraph("Calculos tecnicos", h2))
    calcs = case.get("calculations", [])
    if calcs:
        data_rows = [["Tipo", "Datos", "Resultado"]]
        for c in calcs:
            inputs_str = ", ".join(f"{k}: {v}" for k, v in c.get("inputs", {}).items())
            data_rows.append([c.get("label", c.get("type")), inputs_str, c.get("summary", "")])
        ct = Table(data_rows, colWidths=[40 * mm, 60 * mm, 65 * mm])
        ct.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), slate),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E2E8F0")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ]))
        elems.append(ct)
    else:
        elems.append(Paragraph("Sin calculos registrados.", body))

    elems.append(Paragraph("Notas del caso", h2))
    if notes:
        for n in notes:
            elems.append(Paragraph(f"<b>{fmt_date(n.get('date'))}</b>", small))
            elems.append(Paragraph((n.get("text") or "").replace("\n", "<br/>"), body))
            for ph in n.get("photos", [])[:4]:
                try:
                    raw = ph.split(",", 1)[1] if ph.startswith("data:") else ph
                    img_data = BytesIO(base64.b64decode(raw))
                    elems.append(Spacer(1, 4))
                    elems.append(RLImage(img_data, width=70 * mm, height=52 * mm, kind="proportional"))
                except Exception:
                    continue
            elems.append(Spacer(1, 10))
    else:
        elems.append(Paragraph("Sin notas registradas.", body))

    elems.append(Spacer(1, 16))
    elems.append(Paragraph("Documento generado por Preservia. Uso profesional.", small))

    doc.build(elems)
    return buf.getvalue()


@api_router.get("/cases/{case_id}/report")
async def generate_report(case_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    c = await db.cases.find_one({"case_id": case_id, "user_id": user["user_id"]}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    notes = await db.notes.find({"case_id": case_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    pdf_bytes = build_pdf(c, notes, user)
    b64 = base64.b64encode(pdf_bytes).decode("utf-8")
    safe = (c.get("name") or "caso").replace(" ", "_")[:40]
    return {"filename": f"Preservia_{safe}.pdf", "pdf_base64": b64, "mime": "application/pdf"}


# ----------------------------- Library documents -----------------------------
@api_router.post("/library/documents")
async def add_document(data: DocumentInput, user: Dict[str, Any] = Depends(get_current_user)):
    grid_id, size = await store_pdf(data.pdf_base64, data.filename)
    doc = {
        "doc_id": f"doc_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "title": data.title,
        "filename": data.filename,
        "grid_id": grid_id,
        "size": size,
        "created_at": now_iso(),
    }
    await db.documents.insert_one(dict(doc))
    doc.pop("grid_id", None)
    return {"document": doc}


@api_router.get("/library/documents")
async def list_documents(user: Dict[str, Any] = Depends(get_current_user)):
    docs = await db.documents.find(
        {"user_id": user["user_id"]}, {"_id": 0, "pdf_base64": 0, "grid_id": 0}
    ).sort("created_at", -1).to_list(500)
    return {"documents": docs}


@api_router.get("/library/documents/{doc_id}")
async def get_document(doc_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    d = await db.documents.find_one(
        {"doc_id": doc_id, "user_id": user["user_id"]}, {"_id": 0}
    )
    if not d:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    d["pdf_base64"] = await load_pdf_b64(d)
    d.pop("grid_id", None)
    return {"document": d}


@api_router.delete("/library/documents/{doc_id}")
async def delete_document(doc_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    d = await db.documents.find_one({"doc_id": doc_id, "user_id": user["user_id"]})
    if not d:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    await delete_pdf(d)
    await db.documents.delete_one({"doc_id": doc_id})
    return {"ok": True}


# ----------------------------- Shared catalog (admin-managed) -----------------------------
CATALOG_CATEGORIES = {"ficha_tecnica", "hoja_seguridad"}


@api_router.post("/catalog/documents")
async def add_catalog_document(data: CatalogInput, user: Dict[str, Any] = Depends(get_current_admin)):
    if data.category not in CATALOG_CATEGORIES:
        raise HTTPException(status_code=400, detail="Categoria invalida")
    grid_id, size = await store_pdf(data.pdf_base64, data.filename)
    doc = {
        "doc_id": f"cat_{uuid.uuid4().hex[:12]}",
        "category": data.category,
        "title": data.title,
        "filename": data.filename,
        "grid_id": grid_id,
        "size": size,
        "uploaded_by": user["email"],
        "created_at": now_iso(),
    }
    await db.catalog.insert_one(dict(doc))
    doc.pop("grid_id", None)
    return {"document": doc}


@api_router.get("/catalog/documents")
async def list_catalog_documents(category: Optional[str] = None, user: Dict[str, Any] = Depends(get_current_user)):
    query: Dict[str, Any] = {}
    if category:
        if category not in CATALOG_CATEGORIES:
            raise HTTPException(status_code=400, detail="Categoria invalida")
        query["category"] = category
    docs = await db.catalog.find(query, {"_id": 0, "pdf_base64": 0, "grid_id": 0}).sort("created_at", -1).to_list(1000)
    return {"documents": docs}


@api_router.get("/catalog/documents/{doc_id}")
async def get_catalog_document(doc_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    d = await db.catalog.find_one({"doc_id": doc_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    d["pdf_base64"] = await load_pdf_b64(d)
    d.pop("grid_id", None)
    return {"document": d}


@api_router.delete("/catalog/documents/{doc_id}")
async def delete_catalog_document(doc_id: str, user: Dict[str, Any] = Depends(get_current_admin)):
    d = await db.catalog.find_one({"doc_id": doc_id})
    if not d:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    await delete_pdf(d)
    await db.catalog.delete_one({"doc_id": doc_id})
    return {"ok": True}


@api_router.get("/")
async def root():
    return {"message": "Preservia API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.cases.create_index("user_id")
    await db.cases.create_index("case_id", unique=True)
    await db.notes.create_index("case_id")
    await db.documents.create_index("user_id")
    await db.catalog.create_index("category")
    logger.info("Preservia API ready")


@app.on_event("shutdown")
async def shutdown():
    client.close()
