import asyncio
import os
import sys

import pytest


PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

import pg_tailscale_proxy as proxy  # noqa: E402


@pytest.mark.asyncio
async def test_socks5_connect_uses_one_greeting_and_one_connect_request(monkeypatch):
    messages = []

    async def fake_socks_server(reader, writer):
        messages.append(await reader.readexactly(3))
        writer.write(b"\x05\x00")
        await writer.drain()
        messages.append(await reader.readexactly(10))
        writer.write(b"\x05\x00\x00\x01\x7f\x00\x00\x01\x00\x00")
        await writer.drain()
        await reader.read()
        writer.close()
        await writer.wait_closed()

    server = await asyncio.start_server(fake_socks_server, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    monkeypatch.setattr(proxy, "SOCKS_PORT", port)
    monkeypatch.setattr(proxy, "TARGET_HOST", "100.127.197.79")
    monkeypatch.setattr(proxy, "TARGET_PORT", 5432)

    try:
        reader, writer = await proxy.socks5_connect("test-single-handshake")
        del reader
        writer.close()
        await writer.wait_closed()
        await asyncio.sleep(0)
    finally:
        server.close()
        await server.wait_closed()

    assert messages[0] == b"\x05\x01\x00"
    assert messages[1][0:4] == b"\x05\x01\x00\x01"
    assert messages[1][4:8] == bytes([100, 127, 197, 79])
    assert int.from_bytes(messages[1][8:10], "big") == 5432
    assert len(messages) == 2


def test_proxy_target_and_rfc1928_reply_mapping():
    assert proxy.SOCKS_HOST == "127.0.0.1"
    assert proxy.SOCKS_PORT == 1055
    assert proxy.TARGET_HOST == "100.127.197.79"
    assert proxy.TARGET_PORT == 5432
    assert proxy._socks5_reply_meaning(1) == "general SOCKS server failure"
    assert "127.0.0.1:5432" != f"{proxy.TARGET_HOST}:{proxy.TARGET_PORT}"
