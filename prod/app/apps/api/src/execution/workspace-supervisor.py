"""Linux workspace guardian. Guard descriptors remain here until all children drain."""
import argparse
import ctypes
import errno
import os
import signal
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fd-count', type=int, required=True)
    parser.add_argument('--parent', type=int, required=True)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or args.fd_count < 1 or args.parent < 1:
        return 125
    stopping = False
    uncertain = False

    def stop(_number, _frame):
        nonlocal stopping
        stopping = True

    for number in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(number, stop)
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        # Become the adoptive parent of orphaned double-fork/setsid children.
        if libc.prctl(36, 1, 0, 0, 0) != 0 or libc.prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
            return 125
        if os.getppid() != args.parent or os.environ.get('ORBIT_WORKSPACE_SUPERVISOR_PARENT_PID', str(args.parent)) != str(args.parent):
            return 125
        for descriptor in range(3, 3 + args.fd_count):
            os.fstat(descriptor)
            os.set_inheritable(descriptor, False)
    except (OSError, AttributeError):
        return 125
    if stopping:
        return 125
    try:
        # Only this guardian needs to retain the guards; commands may close all FDs.
        child = subprocess.Popen(command, close_fds=True)
    except (OSError, ValueError):
        return 125
    direct_status = None
    teardown_at = None
    empty_rounds = 0

    def descendants():
        pending = [os.getpid()]
        found = set()
        while pending:
            parent = pending.pop()
            try:
                tasks = os.listdir('/proc/%d/task' % parent)
            except FileNotFoundError:
                continue
            for task in tasks:
                try:
                    with open('/proc/%d/task/%s/children' % (parent, task), encoding='ascii') as source:
                        children = [int(value) for value in source.read().split()]
                except FileNotFoundError:
                    continue
                for pid in children:
                    if pid not in found:
                        found.add(pid)
                        pending.append(pid)
        return found

    def send(pid, number):
        # pidfds prevent PID reuse from turning a cleanup signal into a signal to
        # an unrelated process. Revalidate ancestry after opening the descriptor.
        try:
            descriptor = os.pidfd_open(pid)
        except ProcessLookupError:
            return
        try:
            if pid in descendants():
                signal.pidfd_send_signal(descriptor, number)
        except ProcessLookupError:
            pass
        finally:
            os.close(descriptor)

    while True:
        no_children = False
        try:
            while True:
                pid, status = os.waitpid(-1, os.WNOHANG)
                if pid == 0:
                    break
                if pid == child.pid:
                    direct_status = os.waitstatus_to_exitcode(status)
                    child.returncode = direct_status
        except ChildProcessError:
            no_children = True
        except OSError as error:
            if error.errno != errno.EINTR:
                uncertain = True
                stopping = True
        if os.getppid() != args.parent:
            stopping = True
        try:
            remaining = descendants()
        except (OSError, ValueError):
            uncertain = True
            stopping = True
            remaining = set()
        if direct_status is not None or stopping:
            if teardown_at is None:
                teardown_at = time.monotonic()
            elapsed = time.monotonic() - teardown_at
            for pid in remaining:
                try:
                    send(pid, signal.SIGTERM if elapsed < .3 else signal.SIGKILL)
                except (OSError, AttributeError, ValueError):
                    uncertain = True
            # ECHILD is the authoritative check, not a transient empty proc list.
            if no_children and not remaining:
                empty_rounds += 1
                if empty_rounds >= 3:
                    break
            else:
                empty_rounds = 0
            if elapsed > 5:
                return 125
        time.sleep(.02)
    if uncertain or stopping or direct_status is None or not 0 <= direct_status < 125:
        return 125
    return direct_status


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        sys.exit(125)
