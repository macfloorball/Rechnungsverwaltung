"""Uvicorn lifecycle adapter controlled only by the owning launcher's stdin pipe."""
import argparse
import functools
import logging
import multiprocessing
import os
import sys
import threading

import uvicorn
from uvicorn.supervisors import ChangeReload
from uvicorn._subprocess import get_subprocess


def serve(config, stop, sockets=None):
    server = uvicorn.Server(config)

    def request_shutdown():
        stop.wait()
        server.should_exit = True

    threading.Thread(target=request_shutdown, daemon=True).start()
    server.run(sockets=sockets)


class ManagedReload(ChangeReload):
    def __init__(self, config, target, sockets, worker_stop):
        super().__init__(config, target, sockets)
        # The filesystem watcher already captured should_exit in its constructor.
        # Keep that event and signal the separate cross-process event explicitly.
        self.worker_stop = worker_stop

    def _spawn_without_control_input(self, operation):
        # Uvicorn otherwise asks stdin.fileno() while the control thread may
        # hold its buffered-reader lock. The owner pipe belongs to this process,
        # not to reload workers. Uvicorn supports sys.stdin being None.
        control_input = sys.stdin
        null_input = None
        try:
            sys.stdin = None
            if sys.platform == "win32":
                import ctypes
                import msvcrt

                kernel = ctypes.WinDLL("kernel32", use_last_error=True)
                kernel.GetStdHandle.argtypes = [ctypes.c_ulong]
                kernel.GetStdHandle.restype = ctypes.c_void_p
                kernel.SetStdHandle.argtypes = [ctypes.c_ulong, ctypes.c_void_p]
                kernel.SetStdHandle.restype = ctypes.c_int
                stdin_handle = -10 & 0xffffffff  # STD_INPUT_HANDLE
                owner_handle = kernel.GetStdHandle(stdin_handle)
                null_input = open(os.devnull, "rb")
                # sys.stdin=None only affects Uvicorn's Python-level handoff.
                # Windows also gives CreateProcess children the native standard
                # handle. Python startup can block on that synchronous pipe
                # while the owner's control thread is reading it (bpo-34780).
                if not kernel.SetStdHandle(stdin_handle, msvcrt.get_osfhandle(null_input.fileno())):
                    raise ctypes.WinError(ctypes.get_last_error())
            operation()
        finally:
            try:
                if null_input is not None:
                    if not kernel.SetStdHandle(stdin_handle, owner_handle):
                        raise ctypes.WinError(ctypes.get_last_error())
            finally:
                if null_input is not None:
                    null_input.close()
                sys.stdin = control_input

    def startup(self):
        self._spawn_without_control_input(super().startup)

    def restart(self):
        # Wake and finish the old worker's Event waiter before reusing the
        # shared Event. Killing a waiting process can strand its condition.
        self._stop_worker()
        if self.should_exit.is_set():
            return
        self.worker_stop.clear()

        def start():
            self.process = get_subprocess(config=self.config, target=self.target, sockets=self.sockets)
            self.process.start()

        self._spawn_without_control_input(start)

    def _stop_worker(self):
        # The shared event requests graceful shutdown inside the worker, including
        # on Windows where SIGTERM/taskkill would otherwise terminate immediately.
        self.worker_stop.set()
        self.process.join(17)
        forced = self.process.is_alive()
        if forced:
            logging.getLogger("uvicorn.error").error(
                "Worker-Shutdown überschritten; erzwungenes Beenden kann laufende Datenoperationen unterbrechen"
            )
            self.process.terminate()
            self.process.join(2)
            if self.process.is_alive():
                self.process.kill()
                self.process.join(1)
        if forced:
            raise RuntimeError("Worker musste erzwungen beendet werden")

    def shutdown(self):
        self.should_exit.set()
        try:
            self._stop_worker()
        finally:
            for sock in self.sockets:
                sock.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("app")
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--reload-dir", action="append")
    args = parser.parse_args()
    config = uvicorn.Config(
        args.app, host=args.host, port=args.port, reload=args.reload,
        reload_dirs=args.reload_dir, timeout_graceful_shutdown=15,
    )
    stop = multiprocessing.get_context("spawn").Event()

    reloader = None
    if args.reload:
        sock = config.bind_socket()
        reloader = ManagedReload(config, target=functools.partial(serve, config, stop), sockets=[sock], worker_stop=stop)

    control_input = sys.stdin

    def control():
        # EOF also covers a launcher that disappears without a normal shutdown.
        for line in control_input:
            if line.strip() == "shutdown":
                break
        stop.set()
        if reloader is not None:
            reloader.should_exit.set()

    threading.Thread(target=control, daemon=True).start()
    if reloader is not None:
        reloader.run()
    else:
        serve(config, stop)


if __name__ == "__main__":
    main()
