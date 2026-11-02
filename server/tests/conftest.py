import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp()
os.environ["DATA_DIR"] = _tmp
os.environ["SECRET_KEY"] = "test"
os.environ["STATIC_DIR"] = os.path.join(_tmp, "no-static")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def auth(client):
    r = client.post("/api/auth/register", json={"email": "test@example.com", "password": "secret123", "name": "تست"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}
