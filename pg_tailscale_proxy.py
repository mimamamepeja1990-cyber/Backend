import asyncio
import ipaddress
import time
import traceback


LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 6432

SOCKS_HOST = "127.0.0.1"
SOCKS_PORT = 1055

TARGET_HOST = "100.127.197.79"
TARGET_PORT = 5432

SOCKS5_REPLY_MEANINGS = {
    0: "succeeded",
    1: "general SOCKS server failure",
    2: "connection not allowed by ruleset",
    3: "network unreachable",
    4: "host unreachable",
    5: "connection refused",
    6: "TTL expired",
    7: "command not supported",
    8: "address type not supported",
}

_connection_sequence = 0
_active_clients = 0


def _next_connection_id() -> str:
    global _connection_sequence
    _connection_sequence += 1
    return f"c{_connection_sequence:06d}"


def _log(message: str) -> None:
    print(f"[proxy] {message}", flush=True)


def _socks5_reply_meaning(code: int) -> str:
    return SOCKS5_REPLY_MEANINGS.get(code, "unknown SOCKS5 reply code")


async def read_exactly(reader: asyncio.StreamReader, size: int) -> bytes:
    return await reader.readexactly(size)


async def socks5_connect(connection_id: str = "diagnostic"):
    """Open one SOCKS5 connection and establish one CONNECT tunnel."""
    started = time.perf_counter()
    writer = None
    _log(
        f"[{connection_id}] SOCKS5 attempt start socks={SOCKS_HOST}:{SOCKS_PORT} "
        f"target={TARGET_HOST}:{TARGET_PORT} handshake=single"
    )

    try:
        _log(
            f"[{connection_id}] SOCKS5 opening local connection "
            f"to {SOCKS_HOST}:{SOCKS_PORT}"
        )
        reader, writer = await asyncio.open_connection(SOCKS_HOST, SOCKS_PORT)
        _log(
            f"[{connection_id}] SOCKS5 local connection created "
            f"peer={writer.get_extra_info('peername')}"
        )

        # SOCKS5 greeting: version 5, one method, no authentication.
        writer.write(b"\x05\x01\x00")
        await writer.drain()
        _log(f"[{connection_id}] SOCKS5 greeting sent methods=no-auth")

        response = await read_exactly(reader, 2)
        _log(
            f"[{connection_id}] SOCKS5 method response "
            f"version={response[0] if response else None} "
            f"method={response[1] if len(response) > 1 else None}"
        )
        if response != b"\x05\x00":
            raise RuntimeError(f"SOCKS5 authentication failed: {response!r}")

        ip = ipaddress.ip_address(TARGET_HOST)
        request = (
            b"\x05"  # SOCKS5
            b"\x01"  # CONNECT
            b"\x00"  # Reserved
            b"\x01"  # IPv4
            + ip.packed
            + TARGET_PORT.to_bytes(2, "big")
        )
        writer.write(request)
        await writer.drain()
        _log(
            f"[{connection_id}] SOCKS5 CONNECT sent "
            f"destination={TARGET_HOST}:{TARGET_PORT} address_type=ipv4"
        )

        header = await read_exactly(reader, 4)
        if header[0] != 5:
            raise RuntimeError(f"Invalid SOCKS5 response version: {header[0]}")

        reply = header[1]
        address_type = header[3]
        _log(
            f"[{connection_id}] SOCKS5 CONNECT response "
            f"version={header[0]} reply_code={reply} "
            f"meaning={_socks5_reply_meaning(reply)} address_type={address_type}"
        )

        # Consume the bound address and port from the SOCKS5 response.
        if address_type == 1:
            await read_exactly(reader, 4)
        elif address_type == 3:
            length = (await read_exactly(reader, 1))[0]
            await read_exactly(reader, length)
        elif address_type == 4:
            await read_exactly(reader, 16)
        else:
            raise RuntimeError(f"Unknown SOCKS5 address type: {address_type}")
        await read_exactly(reader, 2)

        if reply != 0:
            raise RuntimeError(
                f"SOCKS5 CONNECT failed with code {reply} "
                f"({_socks5_reply_meaning(reply)})"
            )

        _log(
            f"[{connection_id}] SOCKS5 CONNECT success "
            f"duration={((time.perf_counter() - started) * 1000):.1f}ms"
        )
        return reader, writer

    except BaseException:
        _log(
            f"[{connection_id}] SOCKS5 attempt failed "
            f"duration={((time.perf_counter() - started) * 1000):.1f}ms\n"
            f"{traceback.format_exc().rstrip()}"
        )
        try:
            if writer is not None:
                writer.close()
                await writer.wait_closed()
                _log(f"[{connection_id}] SOCKS5 socket closed after failure")
        except Exception:
            _log(
                f"[{connection_id}] SOCKS5 socket close failed\n"
                f"{traceback.format_exc().rstrip()}"
            )
        raise


async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    """Copy data from one socket to the other until it closes."""
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (ConnectionResetError, BrokenPipeError):
        pass
    except Exception:
        _log(f"pipe error\n{traceback.format_exc().rstrip()}")
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def handle_client(
    client_reader: asyncio.StreamReader,
    client_writer: asyncio.StreamWriter,
):
    """Create one SOCKS5 tunnel for one PostgreSQL client connection."""
    global _active_clients

    remote_writer = None
    connection_id = _next_connection_id()
    connection_started = time.perf_counter()
    _active_clients += 1
    client_address = client_writer.get_extra_info("peername")

    try:
        _log(
            f"[{connection_id}] client connection created from={client_address} "
            f"active_clients={_active_clients}"
        )

        # Exactly one SOCKS5 open, greeting and CONNECT per client connection.
        remote_reader, remote_writer = await socks5_connect(connection_id)
        _log(
            f"[{connection_id}] tunnel connected destination="
            f"{TARGET_HOST}:{TARGET_PORT} active_clients={_active_clients}"
        )

        await asyncio.gather(
            pipe(client_reader, remote_writer),
            pipe(remote_reader, client_writer),
        )

    except Exception as exc:
        _log(
            f"[{connection_id}] connection failed exception={type(exc).__name__}: {exc}\n"
            f"{traceback.format_exc().rstrip()}"
        )

    finally:
        try:
            client_writer.close()
            await client_writer.wait_closed()
        except Exception:
            pass

        if remote_writer is not None:
            try:
                remote_writer.close()
                await remote_writer.wait_closed()
            except Exception:
                pass

        _active_clients = max(0, _active_clients - 1)
        _log(
            f"[{connection_id}] connection closed from={client_address} "
            f"duration={((time.perf_counter() - connection_started) * 1000):.1f}ms "
            f"active_clients={_active_clients}"
        )


async def startup_connectivity_probe() -> None:
    """Diagnostic-only probe; it never prevents the proxy from serving."""
    probe_id = "startup-probe"
    started = time.perf_counter()
    _log(
        f"[{probe_id}] connectivity check start "
        f"local_socks={SOCKS_HOST}:{SOCKS_PORT} "
        f"target={TARGET_HOST}:{TARGET_PORT}"
    )
    try:
        reader, writer = await asyncio.wait_for(socks5_connect(probe_id), timeout=10.0)
        del reader
        writer.close()
        await writer.wait_closed()
        _log(
            f"[{probe_id}] connectivity check success "
            f"duration={((time.perf_counter() - started) * 1000):.1f}ms"
        )
    except Exception:
        _log(
            f"[{probe_id}] connectivity check failed "
            f"duration={((time.perf_counter() - started) * 1000):.1f}ms\n"
            f"{traceback.format_exc().rstrip()}"
        )


async def main():
    _log(
        f"configuration listen={LISTEN_HOST}:{LISTEN_PORT} "
        f"socks={SOCKS_HOST}:{SOCKS_PORT} "
        f"target={TARGET_HOST}:{TARGET_PORT}"
    )
    server = await asyncio.start_server(handle_client, LISTEN_HOST, LISTEN_PORT)

    _log(
        f"listening on {LISTEN_HOST}:{LISTEN_PORT} "
        f"-> {TARGET_HOST}:{TARGET_PORT}"
    )

    async with server:
        # Explicit diagnostic connection, separate from client database
        # tunnels. Each client still performs exactly one SOCKS5 handshake.
        asyncio.create_task(startup_connectivity_probe())
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
