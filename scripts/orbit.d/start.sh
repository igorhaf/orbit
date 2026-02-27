# =============================================================================
# ORBIT Start Module
# =============================================================================

start_postgres() {
    if is_pg_running; then
        success "PostgreSQL already running (port 5432)"
    else
        info "Starting PostgreSQL..."
        sudo_run service postgresql start
        sleep 2
        if is_pg_running; then
            success "PostgreSQL started (port 5432)"
        else
            error "Failed to start PostgreSQL"
            return 1
        fi
    fi
}

start_redis() {
    if is_redis_running; then
        success "Redis already running (port 6379)"
    else
        info "Starting Redis..."
        sudo_run service redis-server start
        sleep 1
        if is_redis_running; then
            success "Redis started (port 6379)"
        else
            error "Failed to start Redis"
            return 1
        fi
    fi
}

start_backend() {
    ensure_dirs
    if is_backend_running; then
        success "Backend already running (port 8000, PID $(cat "$BACKEND_PID"))"
        return 0
    fi

    # Kill any orphan process on port 8000
    local orphan_pid
    orphan_pid=$(ss -tlnp 2>/dev/null | grep ":8000 " | grep -oP 'pid=\K[0-9]+' | head -1 || true)
    if [[ -n "$orphan_pid" ]]; then
        warn "Killing orphan process on port 8000 (PID $orphan_pid)"
        _kill_tree "$orphan_pid"
        sleep 2
    fi

    info "Starting Backend (FastAPI)..."

    # Source .env for backend
    if [[ -f "${ORBIT_ROOT}/.env" ]]; then
        set -a
        source "${ORBIT_ROOT}/.env"
        set +a
    fi

    export PATH="$HOME/.local/bin:$PATH"
    cd "${BACKEND_DIR}"
    PYTHONUNBUFFERED=1 nohup poetry run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload \
        --reload-exclude '__pycache__' \
        --reload-exclude '*.pyc' \
        --reload-exclude 'storage/*' \
        --reload-exclude 'logs/*' \
        --reload-exclude '*.log' \
        --reload-exclude '*.md' \
        > "$BACKEND_LOG" 2>&1 &
    echo $! > "$BACKEND_PID"

    # Wait for backend to be fully ready
    info "Waiting for backend to be ready..."
    local tries=0
    local max_wait=30
    while [[ $tries -lt $max_wait ]]; do
        if ! kill -0 "$(cat "$BACKEND_PID")" 2>/dev/null; then
            error "Backend process died during startup. Check logs: orbit logs backend"
            rm -f "$BACKEND_PID"
            return 1
        fi
        if curl -sf http://localhost:8000/api/v1/projects/ >/dev/null 2>&1; then
            success "Backend started (port 8000, PID $(cat "$BACKEND_PID"))"
            return 0
        fi
        tries=$((tries + 1))
        sleep 1
    done

    if is_backend_running; then
        success "Backend started (port 8000, PID $(cat "$BACKEND_PID")) — still loading"
    else
        error "Backend failed to start. Check logs: orbit logs backend"
        return 1
    fi
}

start_frontend() {
    ensure_dirs
    if is_frontend_running; then
        success "Frontend already running (port 3000, PID $(cat "$FRONTEND_PID"))"
        return 0
    fi

    # Kill any orphan process on port 3000
    local orphan_pid
    orphan_pid=$(ss -tlnp 2>/dev/null | grep ":3000 " | grep -oP 'pid=\K[0-9]+' | head -1 || true)
    if [[ -n "$orphan_pid" ]]; then
        warn "Killing orphan process on port 3000 (PID $orphan_pid)"
        _kill_tree "$orphan_pid"
        sleep 2
    fi

    info "Starting Frontend (Next.js)..."
    cd "${FRONTEND_DIR}"
    nohup npm run dev > "$FRONTEND_LOG" 2>&1 &
    echo $! > "$FRONTEND_PID"

    # Wait for frontend to be ready
    info "Waiting for frontend to be ready..."
    local tries=0
    local max_wait=20
    while [[ $tries -lt $max_wait ]]; do
        if ! kill -0 "$(cat "$FRONTEND_PID")" 2>/dev/null; then
            error "Frontend process died during startup. Check logs: orbit logs frontend"
            rm -f "$FRONTEND_PID"
            return 1
        fi
        if curl -sf http://localhost:3000 >/dev/null 2>&1; then
            success "Frontend started (port 3000, PID $(cat "$FRONTEND_PID"))"
            return 0
        fi
        tries=$((tries + 1))
        sleep 1
    done

    if is_frontend_running; then
        success "Frontend started (port 3000, PID $(cat "$FRONTEND_PID")) — still compiling"
    else
        error "Frontend failed to start. Check logs: orbit logs frontend"
        return 1
    fi
}

cmd_start() {
    local service="${1:-all}"
    header "ORBIT Start"

    case "$service" in
        all)
            start_postgres
            start_redis
            start_backend
            start_frontend
            echo ""
            cmd_status
            ;;
        postgres|pg|db)
            start_postgres
            ;;
        redis)
            start_redis
            ;;
        backend|api)
            start_backend
            ;;
        frontend|web)
            start_frontend
            ;;
        *)
            error "Unknown service: $service"
            echo "  Available: postgres, redis, backend, frontend, all"
            exit 1
            ;;
    esac
}
