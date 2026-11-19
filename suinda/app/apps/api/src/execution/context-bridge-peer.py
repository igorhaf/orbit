"""Linux single-use UDS relay. Authority comes from host-pinned kernel peer identity.
Private stdin/stdout belong to the Orbit host; no public auth token is accepted.
This does not isolate against ptrace/procfs, a compromised host or Linux root.
"""
import json, os, select, selectors, signal, socket, stat, struct, sys, time


def emit(value):
    sys.stdout.buffer.write(json.dumps(value, separators=(',', ':')).encode() + b'\n')
    sys.stdout.buffer.flush()


def identity(pid):
    with open('/proc/%d/stat' % pid, 'r', encoding='ascii') as handle:
        text = handle.read(8192)
    tail = text[text.rfind(')') + 2:].split()
    if len(tail) < 20 or tail[0] == 'Z':
        raise ValueError('dead_peer')
    return tail[19]


def main():
    if sys.platform != 'linux' or not hasattr(socket, 'SO_PEERCRED') or not hasattr(os, 'pidfd_open'):
        raise ValueError('unsupported_platform')
    raw = sys.stdin.buffer.readline(16385)
    if len(raw) > 16384 or not raw.endswith(b'\n'):
        raise ValueError('invalid_bootstrap')
    config = json.loads(raw)
    path = config['path']
    directory = os.path.dirname(path)
    parent = os.lstat(directory)
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or stat.S_IMODE(parent.st_mode) != 0o700 or os.path.realpath(directory) != directory or os.path.lexists(path):
        raise ValueError('unsafe_endpoint')
    frame = config['maxFrameBytes']
    response_limit = config['maxResponseBytes']
    pending_limit = config['maxPendingRequests']
    timeout = config['handshakeTimeoutMs'] / 1000
    if type(frame) is not int or not 256 <= frame <= 1048576 or type(response_limit) is not int or not 256 <= response_limit <= 1048576 or type(pending_limit) is not int or not 1 <= pending_limit <= 16 or not 0.1 <= timeout <= 30:
        raise ValueError('invalid_limits')
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(path)
    os.chmod(path, 0o600)
    owned = os.lstat(path)
    listener.listen(1)
    listener.setblocking(False)
    selector = selectors.DefaultSelector()
    selector.register(sys.stdin.fileno(), selectors.EVENT_READ, 'host')
    emit({'event': 'ready'})
    expected = None
    peer = None
    peer_pidfd = None
    controls = b''
    requests = b''
    pending = set()
    sequence = 0
    deadline = time.monotonic() + timeout
    refusals = 0
    try:
        while True:
            if peer is None and time.monotonic() >= deadline:
                raise ValueError('handshake_timeout')
            for key, _ in selector.select(0.1):
                if key.data == 'host':
                    chunk = os.read(sys.stdin.fileno(), 65536)
                    if not chunk:
                        return
                    controls += chunk
                    if len(controls) > response_limit + 16384:
                        raise ValueError('host_frame_limit')
                    while b'\n' in controls:
                        line, controls = controls.split(b'\n', 1)
                        command = json.loads(line)
                        if command.get('type') == 'close':
                            return
                        if command.get('type') == 'authorize':
                            value = command['identity']
                            if expected is not None or peer is not None or set(value) != {'pid', 'startTime', 'uid'} or type(value['pid']) is not int or value['pid'] < 1 or type(value['uid']) is not int or value['uid'] != os.getuid() or not isinstance(value['startTime'], str) or not value['startTime'].isdigit() or identity(value['pid']) != value['startTime']:
                                raise ValueError('invalid_peer_authorization')
                            expected = value
                            peer_pidfd = os.pidfd_open(value['pid'], 0)
                            if identity(value['pid']) != value['startTime']:
                                raise ValueError('peer_replaced')
                            selector.register(peer_pidfd, selectors.EVENT_READ, 'pidfd')
                            selector.register(listener, selectors.EVENT_READ, 'listen')
                            emit({'event': 'authorized'})
                        elif command.get('type') == 'response':
                            request_id = command['id']
                            if peer is None or request_id not in pending or expected is None or select.select([peer_pidfd], [], [], 0)[0] or identity(expected['pid']) != expected['startTime']:
                                raise ValueError('unexpected_response')
                            value = json.dumps(command['response'], separators=(',', ':'), ensure_ascii=False).encode('utf8') + b'\n'
                            if len(value) > response_limit + 1:
                                raise ValueError('response_frame_limit')
                            peer.sendall(value)
                            pending.remove(request_id)
                        else:
                            raise ValueError('unknown_control')
                elif key.data == 'pidfd':
                    return
                elif key.data == 'listen':
                    candidate, _ = listener.accept()
                    pid, uid, _gid = struct.unpack('3i', candidate.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))
                    valid = expected is not None and pid == expected['pid'] and uid == expected['uid'] and not select.select([peer_pidfd], [], [], 0)[0]
                    try:
                        valid = valid and identity(pid) == expected['startTime']
                    except (OSError, ValueError):
                        valid = False
                    if not valid:
                        candidate.close()
                        refusals += 1
                        if refusals >= 8:
                            raise ValueError('peer_refusal_limit')
                        continue
                    peer = candidate
                    peer.settimeout(0.5)
                    selector.unregister(listener)
                    listener.close()
                    os.unlink(path)
                    selector.register(peer, selectors.EVENT_READ, 'peer')
                    emit({'event': 'connected'})
                elif key.data == 'peer':
                    if expected is None or select.select([peer_pidfd], [], [], 0)[0] or identity(expected['pid']) != expected['startTime']:
                        raise ValueError('peer_replaced')
                    chunk = peer.recv(65536)
                    if not chunk:
                        return
                    requests += chunk
                    if len(requests) > frame * (pending_limit + 1):
                        raise ValueError('request_queue_limit')
                    while b'\n' in requests:
                        line, requests = requests.split(b'\n', 1)
                        if len(line) > frame or len(pending) >= pending_limit:
                            raise ValueError('request_frame_limit')
                        request = json.loads(line)
                        sequence += 1
                        pending.add(sequence)
                        emit({'event': 'request', 'id': sequence, 'request': request})
                    if len(requests) > frame:
                        raise ValueError('request_frame_limit')
    finally:
        selector.close()
        if peer is not None:
            peer.close()
        listener.close()
        if peer_pidfd is not None:
            os.close(peer_pidfd)
        try:
            current = os.lstat(path)
            if current.st_dev == owned.st_dev and current.st_ino == owned.st_ino and stat.S_ISSOCK(current.st_mode):
                os.unlink(path)
        except FileNotFoundError:
            pass


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        main()
    except Exception:
        # Never expose control frames, paths, peer identity or data in diagnostics.
        sys.stderr.write('Orbit context peer channel refused or failed.\n')
        sys.exit(1)
