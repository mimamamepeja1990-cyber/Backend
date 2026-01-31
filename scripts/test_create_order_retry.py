"""Test script to simulate DB commit failing due to missing user_* columns and verify retry path."""
import json
from app import crud, schemas

class FakeBind:
    def get_columns(self, table_name):
        # Pretend the DB has the user_* columns (so kwargs will include them)
        return [{'name': 'id'}, {'name': 'items'}, {'name': 'total'}, {'name': 'status'}, {'name': 'user_id'}, {'name': 'user_full_name'}]

class FakeSession:
    def __init__(self):
        self._add_obj = None
        self._commit_calls = 0
    def get_bind(self):
        return FakeBind()
    def add(self, obj):
        self._add_obj = obj
    def commit(self):
        self._commit_calls += 1
        if self._commit_calls == 1:
            # Simulate Postgres undefined column error on first commit
            raise Exception("(psycopg2.errors.UndefinedColumn) column \"user_id\" of relation \"orders\" does not exist")
        # else succeed
    def rollback(self):
        pass
    def refresh(self, obj):
        # mimic DB returning created obj - ensure items is a JSON string initially
        if isinstance(obj.items, str):
            # leave as-is
            pass
    def close(self):
        pass

payload = schemas.OrderCreate(items=[schemas.OrderItem(id='f', qty=1, meta={'name':'f'})], total=1.0, user_id=123, user_full_name='Tester')
fs = FakeSession()
order = crud.create_order(fs, payload)
print('Order returned:', {'id': getattr(order, 'id', None), 'items': order.items, 'total': order.total, 'user_id': getattr(order, 'user_id', None), 'user_full_name': getattr(order, 'user_full_name', None)})
