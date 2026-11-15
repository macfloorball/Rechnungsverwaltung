"""Uvicorn lifecycle adapter controlled only by the owning launcher's stdin pipe."""
import argparse
import functools
import logging
import multiprocessing
import sys
import threading

import uvicorn
from uvicorn.supervisors import ChangeReload


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

    def shutdown(self):
        # The shared event requests graceful shutdown inside the worker, including
        # on Windows where SIGTERM/taskkill would otherwise terminate immediately.
        self.should_exit.set()
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
        for sock in self.sockets:
            sock.close()
        if forced:
            raise RuntimeError("Worker musste erzwungen beendet werden")


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

    def control():
        # EOF also covers a launcher that disappears without a normal shutdown.
        for line in sys.stdin:
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
