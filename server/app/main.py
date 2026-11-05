"""Salamat AI server: REST API + on-device model files + the built PWA."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .bootstrap import bootstrap
from .db import db_kind, db_ok, init_db
from .routers import activity, admin, assist, auth, dashboard, food, lab, meds, mood, payments, skin, vitals


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    bootstrap()
    yield


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,  # bearer tokens, no cookies
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (auth, food, skin, lab, mood, vitals, meds, activity, dashboard, payments, admin, assist):
    app.include_router(r.router)


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    errors = exc.errors()
    msg = errors[0].get("msg", "ورودی نامعتبر") if errors else "ورودی نامعتبر"
    field = ".".join(str(p) for p in errors[0].get("loc", [])[1:]) if errors else ""
    return JSONResponse(status_code=422, content={"detail": msg.removeprefix("Value error, "), "field": field})


@app.get("/api/health")
def health():
    ok = db_ok()
    body = {"status": "ok" if ok else "degraded", "app": settings.app_name, "database": db_kind(), "database_ok": ok}
    return JSONResponse(body, status_code=200 if ok else 503)


# Model files the client runs on the device (pose, sleep sounds). Served from our own
# server so the app works even where Google storage is slow or blocked.
_device_models = settings.models_dir / "device"
_device_models.mkdir(parents=True, exist_ok=True)
app.mount("/models", StaticFiles(directory=_device_models), name="models")


# Single-page app: serve files from the client build, and index.html for any other route.
if settings.static_dir.exists():
    _static_root = settings.static_dir.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Not found")
        target = (_static_root / path).resolve()
        if path and target.is_file() and _static_root in target.parents:
            headers = {"Cache-Control": "public, max-age=31536000, immutable"} if path.startswith("assets/") else {}
            return FileResponse(target, headers=headers)
        return FileResponse(_static_root / "index.html", headers={"Cache-Control": "no-cache"})
