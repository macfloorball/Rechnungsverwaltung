import asyncio
import json

from backend.desktop_update_gate import DesktopUpdateGate

TOKEN = "a" * 64


def test_drain_waits_for_complete_response_and_rejects_new_operations(tmp_path):
    async def scenario():
        entered, finish = asyncio.Event(), asyncio.Event()
        writes = tmp_path / "invoice"

        async def business(scope, receive, send):
            entered.set()
            await finish.wait()
            writes.write_text("committed")
            await send({"type": "http.response.start", "status": 200})
            await send({"type": "http.response.body", "body": b"complete"})

        gate = DesktopUpdateGate(business, token=TOKEN)

        async def request(path, action=None, token=TOKEN):
            sent = []
            async def send(message):
                sent.append(message)
            async def receive():
                return {"type": "http.request", "body": b""}
            await gate({"type": "http", "method": "POST", "path": path,
                        "headers": [(b"x-ttc-owner", token.encode()), (b"x-ttc-action", (action or "").encode())]}, receive, send)
            return sent[0]["status"], b"".join(m.get("body", b"") for m in sent)

        operation = asyncio.create_task(request("/api/invoices"))
        await entered.wait()
        pause = asyncio.create_task(request("/_desktop/update-control", "pause"))
        await asyncio.sleep(0)
        assert not pause.done()
        assert (await request("/api/invoices"))[0] == 503
        assert not writes.exists()
        finish.set()
        assert (await operation)[0] == 200
        assert (await pause)[0] == 200
        assert writes.read_text() == "committed"
        assert (await request("/api/invoices"))[0] == 503
        assert (await request("/_desktop/update-control", "resume"))[0] == 200
        assert (await request("/api/invoices"))[0] == 200
        assert (await request("/_desktop/update-control", "pause", token="forged"))[0] == 404
    asyncio.run(scenario())


def test_drain_timeout_reopens_application_without_cancelling_active_write():
    async def scenario():
        entered, finish = asyncio.Event(), asyncio.Event()
        async def business(scope, receive, send):
            entered.set()
            await finish.wait()
            await send({"type": "http.response.start", "status": 200})
        gate = DesktopUpdateGate(business, token=TOKEN, timeout=0.01)
        async def request(path):
            messages = []
            async def send(message): messages.append(message)
            async def receive(): return {"type": "http.request", "body": b""}
            await gate({"type": "http", "path": path, "method": "POST", "headers": [(b"x-ttc-owner", TOKEN.encode()), (b"x-ttc-action", b"pause")]}, receive, send)
            return messages[0]["status"]
        operation = asyncio.create_task(request("/api/backups"))
        await entered.wait()
        assert await request("/_desktop/update-control") == 409
        assert not operation.done()
        assert not gate.paused
        finish.set()
        assert await operation == 200
    asyncio.run(scenario())


def test_web_launch_has_no_owner_control():
    async def scenario():
        sent = []
        async def business(*args): raise AssertionError("control must stay unavailable")
        async def send(message): sent.append(message)
        async def receive(): return {"type": "http.request", "body": b""}
        gate = DesktopUpdateGate(business)
        await gate({"type": "http", "path": "/_desktop/update-control", "method": "POST", "headers": [(b"x-ttc-owner", TOKEN.encode())]}, receive, send)
        assert sent[0]["status"] == 404
    asyncio.run(scenario())
