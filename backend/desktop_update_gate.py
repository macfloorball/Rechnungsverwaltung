"""Owner-authenticated desktop drain gate; absent in ordinary web launches."""
import asyncio
import hmac
import re

from starlette.responses import JSONResponse


class DesktopUpdateGate:
    def __init__(self, app, token=None, timeout=20):
        self.app = app
        self.token = token if isinstance(token, str) and re.fullmatch(r"[a-f0-9]{64}", token) else None
        self.timeout = timeout
        self.paused = False
        self.active = 0
        self.draining = False
        self.empty = asyncio.Event()
        self.empty.set()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        control = scope["path"] == "/_desktop/update-control"
        if control:
            headers = dict(scope.get("headers", []))
            supplied = headers.get(b"x-ttc-owner", b"")
            if not self.token or scope["method"] != "POST" or not hmac.compare_digest(supplied, self.token.encode()):
                return await JSONResponse({"detail": "Not found"}, status_code=404)(scope, receive, send)
            action = headers.get(b"x-ttc-action")
            if self.draining:
                return await JSONResponse({"detail": "Busy"}, status_code=409)(scope, receive, send)
            if action == b"resume":
                self.paused = False
                return await JSONResponse({"ready": True})(scope, receive, send)
            if action != b"pause":
                return await JSONResponse({"detail": "Invalid action"}, status_code=400)(scope, receive, send)
            self.draining = True
            self.paused = True
            try:
                await asyncio.wait_for(self.empty.wait(), self.timeout)
            except (TimeoutError, asyncio.CancelledError):
                self.paused = False
                return await JSONResponse({"detail": "Operations still active"}, status_code=409)(scope, receive, send)
            finally:
                self.draining = False
            return await JSONResponse({"ready": True})(scope, receive, send)
        tracked = self.token and scope["path"].startswith("/api/") and scope["path"] != "/api/health"
        if tracked and self.paused:
            return await JSONResponse({"detail": "Die App bereitet ein Update vor. Bitte kurz warten."}, status_code=503)(scope, receive, send)
        if tracked:
            self.active += 1
            self.empty.clear()
        try:
            return await self.app(scope, receive, send)
        finally:
            if tracked:
                self.active -= 1
                if not self.active:
                    self.empty.set()
