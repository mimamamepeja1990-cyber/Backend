"""Regression test for create_order fallback/retry behavior with fake session."""

from app import crud, schemas


class _FakeDialect:
    name = "sqlite"


class FakeBind:
    def __init__(self, session):
        self._session = session

    dialect = _FakeDialect()

    def get_columns(self, table_name):
        # Pretend DB already has user_* columns so payload fields are included.
        return [
            {"name": "id"},
            {"name": "items"},
            {"name": "total"},
            {"name": "status"},
            {"name": "user_id"},
            {"name": "user_full_name"},
        ]

    def connect(self):
        return _FakeConnection(self._session)


class _FakeExecResult:
    def __init__(self, row=None):
        self._row = row

    def fetchone(self):
        return self._row


class _FakeConnection:
    def __init__(self, session):
        self._session = session

    def execute(self, stmt, _params=None):
        sql = str(stmt if stmt is not None else "").strip().lower()
        if sql.startswith("select"):
            row = (
                int(self._session._last_id or 1),
                self._session._last_items_json or "[]",
                float(self._session._last_total or 0.0),
                "nuevo",
                "2026-01-01T00:00:00",
            )
            return _FakeExecResult(row=row)
        return _FakeExecResult()

    def close(self):
        pass


class _FakeQuery:
    def filter(self, *_args, **_kwargs):
        return self

    def with_for_update(self):
        return self

    def first(self):
        # No product rows in this fake DB; create_order should continue gracefully.
        return None


class FakeSession:
    def __init__(self):
        self._add_obj = None
        self._commit_calls = 0
        self._last_items_json = "[]"
        self._last_total = 0.0
        self._last_id = 1

    def get_bind(self):
        return FakeBind(self)

    def execute(self, stmt, params=None, *_args, **_kwargs):
        sql = str(stmt if stmt is not None else "").strip().lower()
        p = params or {}
        if sql.startswith("insert into orders"):
            self._last_items_json = str(p.get("items", "[]"))
            try:
                self._last_total = float(p.get("total", 0.0) or 0.0)
            except Exception:
                self._last_total = 0.0
        return _FakeExecResult()

    def query(self, *_args, **_kwargs):
        return _FakeQuery()

    def add(self, obj):
        self._add_obj = obj

    def commit(self):
        self._commit_calls += 1
        if self._commit_calls == 1:
            # Simulate Postgres undefined column error on first commit.
            raise Exception(
                '(psycopg2.errors.UndefinedColumn) column "user_id" of relation "orders" does not exist'
            )
        # second commit succeeds

    def rollback(self):
        pass

    def refresh(self, _obj):
        pass

    def close(self):
        pass


def test_create_order_retry_path():
    payload = schemas.OrderCreate(
        items=[schemas.OrderItem(id="f", qty=1, meta={"name": "f"})],
        total=1.0,
        user_id=123,
        user_full_name="Tester",
    )
    fs = FakeSession()
    order = crud.create_order(fs, payload)

    assert order is not None
    assert getattr(order, "total", None) == 1.0
    assert isinstance(getattr(order, "items", None), list)
    # Retry should trigger at least 2 commits (first fails, second succeeds).
    assert fs._commit_calls >= 2
