# =============================================================================
# ORBIT Nuke Module (kill everything hard + restart)
# =============================================================================

cmd_nuke() {
    header "ORBIT Nuke - Hard Reset"

    info "Killing all ORBIT processes..."
    local pids_to_kill=""
    local p

    p=$(ss -tlnp 2>/dev/null | grep ":8000 " | grep -oP 'pid=\K[0-9]+' | head -1 || true)
    [[ -n "$p" ]] && pids_to_kill="$pids_to_kill $p"
    p=$(ss -tlnp 2>/dev/null | grep ":3000 " | grep -oP 'pid=\K[0-9]+' | head -1 || true)
    [[ -n "$p" ]] && pids_to_kill="$pids_to_kill $p"

    for pid in $pids_to_kill; do
        local children
        children=$(pgrep -P "$pid" 2>/dev/null || true)
        pids_to_kill="$pids_to_kill $children"
    done

    for pid in $pids_to_kill; do
        kill -9 "$pid" 2>/dev/null || true
    done
    rm -f "$BACKEND_PID" "$FRONTEND_PID"

    sleep 2
    success "All processes killed"

    start_postgres
    start_redis
    start_backend

    info "Waiting for backend to be ready..."
    local tries=0
    while ! curl -sf http://localhost:8000/health >/dev/null 2>&1; do
        tries=$((tries + 1))
        if [[ $tries -ge 30 ]]; then
            error "Backend did not start in 30s. Check: orbit logs backend"
            break
        fi
        sleep 1
    done
    if [[ $tries -lt 30 ]]; then
        success "Backend ready"
    fi

    start_frontend
    echo ""
    cmd_status
}
