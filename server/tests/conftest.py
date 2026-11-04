import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp()
os.environ["DATA_DIR"] = _tmp
os.environ["SECRET_KEY"] = "test"
os.environ["ADMIN_EMAIL"] = "admin@test.com"
os.environ["ADMIN_PASSWORD"] = "admin-pass-123"
os.environ["STATIC_DIR"] = os.path.join(_tmp, "no-static")
# Run the suite against Postgres with: TEST_DATABASE_URL=postgresql://user:pw@host/db pytest
if os.environ.get("TEST_DATABASE_URL"):
    os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    from sqlmodel import SQLModel

    from app.db import engine

    SQLModel.metadata.drop_all(engine)  # clean slate (matters for a reused Postgres DB)
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def auth(client):
    r = client.post("/api/auth/register", json={"email": "test@example.com", "password": "secret123", "name": "تست"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="session")
def admin(client):
    r = client.post("/api/auth/login", json={"email": "admin@test.com", "password": "admin-pass-123"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["is_admin"] is True
    return {"Authorization": f"Bearer {r.json()['token']}"}
