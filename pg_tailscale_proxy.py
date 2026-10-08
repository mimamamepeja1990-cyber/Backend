```python
import asyncio
import ipaddress


LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 6432

SOCKS_HOST = "127.0.0.1"
SOCKS_PORT = 1055

TARGET_HOST = "100.127.197.79"
TARGET_PORT = 5432


async def read_exactly(
    reader: asyncio.StreamReader,
    size: int,
) -> bytes:
    return await reader.readexactly(size)


async def socks5_connect():
    """
    Abre una conexión al SOCKS5 de Tailscale y establece
    un túnel hacia PostgreSQL en el A32.
    """

    reader, writer = await asyncio.open_connection(
        SOCKS_HOST,
        SOCKS_PORT,
    )

    try:
        # SOCKS5 greeting:
        # Version 5
        # 1 authentication method
        # No authentication
        writer.write(b"\x05\x01\x00")
        await writer.drain()

        response = await read_exactly(reader, 2)

        if response != b"\x05\x00":
            raise RuntimeError(
                f"SOCKS5 authentication failed: {response!r}"
            )

        # Target IPv4
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

        # SOCKS5 response header
        header = await read_exactly(reader, 4)

        if header[0] != 5:
            raise RuntimeError(
                f"Invalid SOCKS5 response version: {header[0]}"
            )

        reply = header[1]
        address_type = header[3]

        # Consume bound address
        if address_type == 1:  # IPv4
            await read_exactly(reader, 4)

        elif address_type == 3:  # Domain
            length = (await read_exactly(reader, 1))[0]
            await read_exactly(reader, length)

        elif address_type == 4:  # IPv6
            await read_exactly(reader, 16)

        else:
            raise RuntimeError(
                f"Unknown SOCKS5 address type: {address_type}"
            )

        # Consume bound port
        await read_exactly(reader, 2)

        if reply != 0:
            raise RuntimeError(
                f"SOCKS5 CONNECT failed with code {reply}"
            )

        return reader, writer

    except Exception:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass

        raise


async def pipe(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
):
    """
    Copia datos de un socket al otro hasta que se cierre
    la conexión.
    """

    try:
        while True:
            data = await reader.read(65536)

            if not data:
                break

            writer.write(data)
            await writer.drain()

    except (ConnectionResetError, BrokenPipeError):
        pass

    except Exception as exc:
        print(
            f"[proxy] pipe error: {exc}",
            flush=True,
        )

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
    """
    Recibe una conexión PostgreSQL desde FastAPI/SQLAlchemy
    y crea un único túnel SOCKS5 hacia PostgreSQL del A32.
    """

    remote_writer = None

    client_address = client_writer.get_extra_info("peername")

    try:
        print(
            f"[proxy] nueva conexión desde {client_address}",
            flush=True,
        )

        # Una única conexión SOCKS5.
        # socks5_connect() ya hace todo el handshake y CONNECT.
        remote_reader, remote_writer = await socks5_connect()

        print(
            f"[proxy] túnel conectado -> "
            f"{TARGET_HOST}:{TARGET_PORT}",
            flush=True,
        )

        # Bidirectional TCP forwarding
        await asyncio.gather(
            pipe(
                client_reader,
                remote_writer,
            ),
            pipe(
                remote_reader,
                client_writer,
            ),
        )

    except Exception as exc:
        print(
            f"[proxy] connection failed: {exc}",
            flush=True,
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

        print(
            f"[proxy] conexión cerrada: {client_address}",
            flush=True,
        )


async def main():
    server = await asyncio.start_server(
        handle_client,
        LISTEN_HOST,
        LISTEN_PORT,
    )

    print(
        f"[proxy] listening on "
        f"{LISTEN_HOST}:{LISTEN_PORT} "
        f"-> {TARGET_HOST}:{TARGET_PORT}",
        flush=True,
    )

    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
```
