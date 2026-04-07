"""Async RBAC proxy with HTTP + WebSocket support."""
import asyncio, json, urllib.parse, struct, hashlib, base64, os
from openclaw_guard.config import load_config, hash_token
from openclaw_guard.audit import AuditLog
from openclaw_guard.masking import mask_body
from openclaw_guard.permissions import check_permission

_cfg = None
_audit = None

def _auth(headers):
    token = headers.get("x-guard-token", "")
    if not token:
        return None
    th = hash_token(token)
    return _cfg["_user_index"].get(th)

def _get_mask_fields(role_name):
    return _cfg.get("roles", {}).get(role_name, {}).get("mask_fields", [])

def _parse_headers(raw):
    headers = {}
    method = path = version = ""
    lines = raw.split(b"\r\n")
    if lines:
        parts = lines[0].decode().split(" ", 2)
        if len(parts) == 3:
            method, path, version = parts
    for line in lines[1:]:
        if b":" in line:
            k, v = line.decode().split(":", 1)
            headers[k.strip().lower()] = v.strip()
    return method, path, version, headers

async def _read_until(reader, sep=b"\r\n\r\n"):
    buf = b""
    while sep not in buf:
        chunk = await reader.read(4096)
        if not chunk:
            break
        buf += chunk
    return buf

async def _forward_bytes(reader, writer):
    try:
        while True:
            data = await reader.read(8192)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (ConnectionResetError, BrokenPipeError, asyncio.CancelledError):
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass

def _err_response(code, msg):
    body = json.dumps({"error": msg}).encode()
    return (f"HTTP/1.1 {code}\r\nContent-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n\r\n").encode() + body

def _whoami_response(user):
    body = json.dumps({"name": user["name"], "role": user["role"]}).encode()
    return (f"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n\r\n").encode() + body

async def _handle_websocket(client_r, client_w, path, headers, user):
    """Proxy WebSocket: upgrade with upstream, then bidirectional forward."""
    up = urllib.parse.urlparse(_cfg["gateway"]["upstream"])
    up_host = up.hostname
    up_port = up.port or 80

    try:
        up_r, up_w = await asyncio.open_connection(up_host, up_port)
    except Exception as e:
        client_w.write(_err_response(502, f"Upstream connect failed: {e}"))
        await client_w.drain()
        return

    # Forward the original upgrade request to upstream (strip guard token)
    fwd_lines = [f"GET {path} HTTP/1.1"]
    for k, v in headers.items():
        if k == "x-guard-token":
            continue
        fwd_lines.append(f"{k}: {v}")
    fwd_lines.append("")
    fwd_lines.append("")
    up_w.write("\r\n".join(fwd_lines).encode())
    await up_w.drain()

    # Read upstream response and forward to client
    up_resp = await _read_until(up_r)
    client_w.write(up_resp)
    await client_w.drain()

    # Check if upgrade was accepted
    if b"101" not in up_resp.split(b"\r\n")[0]:
        _audit.log(user["name"], "WS", path, "upstream_rejected")
        return

    _audit.log(user["name"], "WS", path, "ok")

    # Bidirectional forward
    t1 = asyncio.create_task(_forward_bytes(client_r, up_w))
    t2 = asyncio.create_task(_forward_bytes(up_r, client_w))
    await asyncio.gather(t1, t2, return_exceptions=True)

async def _handle_http(client_w, method, path, version, headers, body, user):
    """Proxy regular HTTP request."""
    up = urllib.parse.urlparse(_cfg["gateway"]["upstream"])
    up_host = up.hostname
    up_port = up.port or 80

    try:
        up_r, up_w = await asyncio.open_connection(up_host, up_port)
    except Exception as e:
        client_w.write(_err_response(502, f"Upstream error: {e}"))
        await client_w.drain()
        return

    # Build forwarded request
    fwd_lines = [f"{method} {path} {version}"]
    for k, v in headers.items():
        if k == "x-guard-token":
            continue
        if k == "host":
            v = f"{up_host}:{up_port}"
        fwd_lines.append(f"{k}: {v}")
    fwd_req = "\r\n".join(fwd_lines).encode() + b"\r\n\r\n"
    if body:
        fwd_req += body

    up_w.write(fwd_req)
    await up_w.drain()

    # Read full upstream response
    resp = await _read_until(up_r)
    # Try to read remaining body
    try:
        extra = await asyncio.wait_for(up_r.read(65536), timeout=1.0)
        resp += extra
    except asyncio.TimeoutError:
        pass

    # Mask sensitive fields for non-admin
    mask_fields = _get_mask_fields(user["role"])
    if mask_fields and b"\r\n\r\n" in resp:
        hdr_part, body_part = resp.split(b"\r\n\r\n", 1)
        body_part = mask_body(body_part, mask_fields)
        # Rewrite content-length
        hdr_lines = hdr_part.decode(errors="replace").split("\r\n")
        new_hdrs = []
        for h in hdr_lines:
            if h.lower().startswith("content-length:"):
                new_hdrs.append(f"Content-Length: {len(body_part)}")
            else:
                new_hdrs.append(h)
        resp = "\r\n".join(new_hdrs).encode() + b"\r\n\r\n" + body_part

    _audit.log(user["name"], method, path, "ok")
    client_w.write(resp)
    await client_w.drain()
    up_w.close()

async def _handle_client(reader, writer):
    try:
        raw = await _read_until(reader)
        if not raw:
            return

        if b"\r\n\r\n" in raw:
            header_part, body = raw.split(b"\r\n\r\n", 1)
        else:
            header_part, body = raw, b""

        method, path, version, headers = _parse_headers(header_part)

        # Auth
        user = _auth(headers)
        if not user:
            writer.write(_err_response(401, "Unauthorized: provide X-Guard-Token header"))
            await writer.drain()
            return

        # /whoami
        if path == "/whoami":
            writer.write(_whoami_response(user))
            await writer.drain()
            return

        # Permission check
        if not check_permission(_cfg.get("roles", {}), user["role"], path):
            _audit.log(user["name"], method, path, "denied")
            writer.write(_err_response(403, f"Forbidden: role '{user['role']}' cannot access {path}"))
            await writer.drain()
            return

        # WebSocket upgrade?
        upgrade = headers.get("upgrade", "").lower()
        if upgrade == "websocket":
            await _handle_websocket(reader, writer, path, headers, user)
        else:
            await _handle_http(writer, method, path, version, headers, body, user)

    except Exception as e:
        try:
            writer.write(_err_response(500, str(e)))
            await writer.drain()
        except Exception:
            pass
    finally:
        try:
            writer.close()
        except Exception:
            pass

async def _run(host, port):
    server = await asyncio.start_server(_handle_client, host, port)
    upstream = _cfg["gateway"]["upstream"]
    n = len(_cfg.get("users", []))
    audit_status = "on" if _audit.enabled else "off"
    print(f"openclaw-guard listening on {host}:{port} → {upstream}")
    print(f"  {n} users, audit={audit_status}, websocket=yes")
    async with server:
        await server.serve_forever()

def start_proxy(config_path, port_override=None):
    global _cfg, _audit
    _cfg = load_config(config_path)
    _audit = AuditLog(_cfg)
    host = _cfg["gateway"]["listen"]
    port = port_override or _cfg["gateway"]["port"]
    asyncio.run(_run(host, port))
