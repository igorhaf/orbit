# =============================================================================
# ORBIT Stop Module
# =============================================================================

stop_frontend() {
    if is_frontend_running; then
        local pid
        pid=$(cat "$FRONTEND_PID")
        info "Stopping Frontend (PID $pid)..."
        kill -- -"$pid" 2>/dev/null || true
        sleep 1
        _kill_tree "$pid"
        # Final cleanup: kill anything still on port 3000
        local orphan_pid
        orphan_pid=$(ss -tlnp 2>/dev/null | grep ":3000 " | grep -oP 'pid=\K[0-9]+' | head -1 || true)
        if [[ -n "$orphan_pid" ]]; then
            warn "Cleaning up orphan on port 3000 (PID $orphan_pid)"
            _kill_tree "$orphan_pid"
        fi
        rm -f "$FRONTEND_PID"
        success "Frontend stopped"
    else
        info "Frontend not running"
    fi
}

stop_backend() {
    if is_backend_running; then
        local pid
        pid=$(cat "$BACKEND_PID")
        info "Stopping Backend (PID $pid)..."
        kill -- -"$pid" 2>/dev/null || true
        sleep 1
        local descendants
        descendants=$(pgrep -g "$pid" 2>/dev/null || true)
        if [[ -z "$descendants" ]]; then
            _kill_tree "$pid"
        fi
        # Final cleanup: kill anything still on port 8000
        local orphan_pid
        orphan_pid=$(ss -tlnp 2>/dev/null | grep ":8000 " | grep -oP 'pid=\K[0-9]+' | head -1 || true)
        if [[ -n "$orphan_pid" ]]; then
            warn "Cleaning up orphan on port 8000 (PID $orphan_pid)"
            _kill_tree "$orphan_pid"
        fi
        rm -f "$BACKEND_PID"
        success "Backend stopped"
    else
        info "Backend not running"
    fi
}

stop_redis() {
    if is_redis_running; then
        info "Stopping Redis..."
        sudo_run service redis-server stop
        sleep 1
        if is_redis_running; then
            warn "Redis didn't stop gracefully, forcing..."
            sudo_run systemctl kill redis-server
            sleep 1
        fi
        success "Redis stopped"
    else
        info "Redis not running"
    fi
}

stop_postgres() {
    if is_pg_running; then
        info "Stopping PostgreSQL..."
        sudo_run service postgresql stop
        success "PostgreSQL stopped"
    else
        info "PostgreSQL not running"
    fi
}

cmd_stop() {
    local service="${1:-all}"
    header "ORBIT Stop"

    case "$service" in
        all)
            stop_frontend
            stop_backend
            stop_redis
            stop_postgres
            echo ""
            success "All services stopped"
            ;;
        postgres|pg|db)
            stop_postgres
            ;;
        redis)
            stop_redis
            ;;
        backend|api)
            stop_backend
            ;;
        frontend|web)
            stop_frontend
            ;;
        *)
            error "Unknown service: $service"
            echo "  Available: postgres, redis, backend, frontend, all"
            exit 1
            ;;
    esac
}
