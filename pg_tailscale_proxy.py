import asyncio
import ipaddress


LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 6432

SOCKS_HOST = "127.0.0.1"
SOCKS_PORT = 1055

TARGET_HOST = "100.127.197.79"
TARGET_PORT = 5432


async def read_exactly(reader: asyncio.StreamReader, size: int) -> bytes:
    data = await reader.readexactly(size)
    return data


async def socks5_connect():
    reader, writer = await asyncio.open_connection(SOCKS_HOST, SOCKS_PORT)

    # SOCKS5 greeting: version 5, one method, no-auth
    writer.write(b"\x05\x01\x00")
    await writer.drain()

    response = await read_exactly(reader, 2)

    if response != b"\x05\x00":
        writer.close()
        await writer.wait_closed()
        raise RuntimeError(f"SOCKS5 authentication failed: {response!r}")

    ip = ipaddress.ip_address(TARGET_HOST)

    request = (
        b"\x05"          # SOCKS5
        b"\x01"          # CONNECT
        b"\x00"          # reserved
        b"\x01"          # IPv4
        + ip.packed
        + TARGET_PORT.to_bytes(2, "big")
    )

    writer.write(request)
    await writer.drain()

    header = await read_exactly(reader, 4)

    if header[0] != 5:
        writer.close()
        await writer.wait_closed()
        raise RuntimeError("Invalid SOCKS5 response")

    reply = header[1]
    address_type = header[3]

    if address_type == 1:       # IPv4
        await read_exactly(reader, 4)
    elif address_type == 3:     # Domain
        length = (await read_exactly(reader, 1))[0]
        await read_exactly(reader, length)
    elif address_type == 4:     # IPv6
        await read_exactly(reader, 16)
    else:
        writer.close()
        await writer.wait_closed()
        raise RuntimeError("Unknown SOCKS5 address type")

    await read_exactly(reader, 2)  # port

    if reply != 0:
        writer.close()
        await writer.wait_closed()
        raise RuntimeError(f"SOCKS5 CONNECT failed with code {reply}")

    return reader, writer


async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        while True:
            data = await reader.read(65536)

            if not data:
                break

            writer.write(data)
            await writer.drain()
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
    remote_writer = None

    try:
        _, remote_writer = await socks5_connect()

        # Open a fresh SOCKS connection to get its reader/writer pair.
        remote_reader, remote_writer = await asyncio.open_connection(
            SOCKS_HOST, SOCKS_PORT
        )

        # SOCKS5 greeting
        remote_writer.write(b"\x05\x01\x00")
        await remote_writer.drain()
        response = await read_exactly(remote_reader, 2)

        if response != b"\x05\x00":
            raise RuntimeError("SOCKS5 greeting failed")

        ip = ipaddress.ip_address(TARGET_HOST)

        request = (
            b"\x05\x01\x00\x01"
            + ip.packed
            + TARGET_PORT.to_bytes(2, "big")
        )

        remote_writer.write(request)
        await remote_writer.drain()

        header = await read_exactly(remote_reader, 4)

        if header[1] != 0:
            raise RuntimeError(f"SOCKS5 CONNECT failed: {header[1]}")

        if header[3] == 1:
            await read_exactly(remote_reader, 4)
        elif header[3] == 3:
            length = (await read_exactly(remote_reader, 1))[0]
            await read_exactly(remote_reader, length)
        elif header[3] == 4:
            await read_exactly(remote_reader, 16)

        await read_exactly(remote_reader, 2)

        await asyncio.gather(
            pipe(client_reader, remote_writer),
            pipe(remote_reader, client_writer),
        )

    except Exception as exc:
        print(f"[proxy] connection failed: {exc}", flush=True)

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


async def main():
    server = await asyncio.start_server(
        handle_client,
        LISTEN_HOST,
        LISTEN_PORT,
    )

    print(
        f"[proxy] listening on {LISTEN_HOST}:{LISTEN_PORT} "
        f"-> {TARGET_HOST}:{TARGET_PORT}",
        flush=True,
    )

    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())