#!/usr/bin/env python3
import fcntl
import os
import pty
import selectors
import signal
import struct
import sys
import termios

OPCODE_DATA = 0x01
OPCODE_RESIZE = 0x02
OPCODE_CLOSE = 0x03


def _set_winsize(fd: int, cols: int, rows: int) -> None:
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


def _exit_code_from_status(status: int) -> int:
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 1


def main() -> int:
    if len(sys.argv) < 2:
        return 2

    command = sys.argv[1:]
    child_pid, master_fd = pty.fork()
    if child_pid == 0:
        os.execvpe(command[0], command, os.environ)

    selector = selectors.DefaultSelector()
    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()
    selector.register(stdin_fd, selectors.EVENT_READ, data="stdin")
    selector.register(master_fd, selectors.EVENT_READ, data="pty")

    incoming = bytearray()
    should_close = False

    while True:
        for key, _ in selector.select(timeout=0.05):
            if key.data == "stdin":
                chunk = os.read(stdin_fd, 65536)
                if not chunk:
                    selector.unregister(stdin_fd)
                    continue

                incoming.extend(chunk)
                while True:
                    if len(incoming) < 1:
                        break

                    opcode = incoming[0]
                    if opcode == OPCODE_DATA:
                        if len(incoming) < 5:
                            break
                        size = struct.unpack(">I", incoming[1:5])[0]
                        if len(incoming) < 5 + size:
                            break
                        payload = bytes(incoming[5:5 + size])
                        del incoming[:5 + size]
                        if payload:
                            os.write(master_fd, payload)
                    elif opcode == OPCODE_RESIZE:
                        if len(incoming) < 5:
                            break
                        cols, rows = struct.unpack(">HH", incoming[1:5])
                        del incoming[:5]
                        _set_winsize(master_fd, cols, rows)
                        os.kill(child_pid, signal.SIGWINCH)
                    elif opcode == OPCODE_CLOSE:
                        del incoming[:1]
                        should_close = True
                    else:
                        del incoming[:1]

            if key.data == "pty":
                try:
                    data = os.read(master_fd, 65536)
                except OSError:
                    data = b""

                if data:
                    os.write(stdout_fd, data)
                else:
                    _, status = os.waitpid(child_pid, 0)
                    return _exit_code_from_status(status)

        if should_close:
            try:
                os.kill(child_pid, signal.SIGHUP)
            except ProcessLookupError:
                pass
            should_close = False

        pid, status = os.waitpid(child_pid, os.WNOHANG)
        if pid == child_pid:
            return _exit_code_from_status(status)


if __name__ == "__main__":
    raise SystemExit(main())
