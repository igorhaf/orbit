# =============================================================================
# ORBIT Logs Module
# =============================================================================

cmd_logs() {
    local service="${1:-all}"
    local lines="${2:-100}"

    # Parse flags: orbit logs backend -n 50 | orbit logs -f backend | orbit logs --last 200
    local follow=false
    local args=()
    for arg in "$@"; do
        case "$arg" in
            -f|--follow) follow=true ;;
            -n) ;;
            --last) ;;
            [0-9]*) lines="$arg" ;;
            *) args+=("$arg") ;;
        esac
    done
    [[ ${#args[@]} -gt 0 ]] && service="${args[0]}"

    case "$service" in
        backend|api)
            if [[ -f "$BACKEND_LOG" ]]; then
                if $follow; then
                    tail -f "$BACKEND_LOG"
                else
                    echo -e "${BOLD}${CYAN}━━━ Backend Logs (last $lines lines) ━━━${NC}"
                    tail -n "$lines" "$BACKEND_LOG"
                fi
            else
                error "No backend log found at $BACKEND_LOG"
            fi
            ;;
        frontend|web)
            if [[ -f "$FRONTEND_LOG" ]]; then
                if $follow; then
                    tail -f "$FRONTEND_LOG"
                else
                    echo -e "${BOLD}${CYAN}━━━ Frontend Logs (last $lines lines) ━━━${NC}"
                    tail -n "$lines" "$FRONTEND_LOG"
                fi
            else
                error "No frontend log found at $FRONTEND_LOG"
            fi
            ;;
        all)
            echo -e "${BOLD}${CYAN}━━━ ORBIT Logs (last $lines lines per service) ━━━${NC}"
            echo ""
            if [[ -f "$BACKEND_LOG" ]]; then
                echo -e "${BOLD}${GREEN}[backend]${NC}"
                tail -n "$lines" "$BACKEND_LOG" | grep -v "sqlalchemy.engine.Engine" | tail -n 30
                echo ""
            fi
            if [[ -f "$FRONTEND_LOG" ]]; then
                echo -e "${BOLD}${YELLOW}[frontend]${NC}"
                tail -n "$lines" "$FRONTEND_LOG" | tail -n 20
                echo ""
            fi
            echo -e "${CYAN}Tip: orbit logs backend -f   (follow mode)${NC}"
            echo -e "${CYAN}     orbit logs backend 200  (last 200 lines)${NC}"
            ;;
        *)
            error "Unknown service: $service. Use: backend, frontend, or all (default)"
            exit 1
            ;;
    esac
}
