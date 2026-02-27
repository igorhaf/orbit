# =============================================================================
# ORBIT Restart Module
# =============================================================================

cmd_restart() {
    local service="${1:-all}"
    header "ORBIT Restart"

    case "$service" in
        all)
            stop_frontend
            stop_backend
            sleep 1
            start_postgres
            start_redis
            start_backend
            start_frontend
            echo ""
            cmd_status
            ;;
        postgres|pg|db)
            stop_postgres; sleep 1; start_postgres
            ;;
        redis)
            stop_redis; sleep 1; start_redis
            ;;
        backend|api)
            stop_backend; sleep 1; start_backend
            ;;
        frontend|web)
            stop_frontend; sleep 1; start_frontend
            ;;
        *)
            error "Unknown service: $service"
            exit 1
            ;;
    esac
}
