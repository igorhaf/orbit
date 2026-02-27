# =============================================================================
# ORBIT Status Module
# =============================================================================

cmd_status() {
    header "ORBIT Service Status"

    local status_icon pid_info

    # PostgreSQL
    if is_pg_running; then
        status_icon="${GREEN}●${NC}"
        echo -e "  ${status_icon}  PostgreSQL      running     port 5432"
    else
        status_icon="${RED}●${NC}"
        echo -e "  ${status_icon}  PostgreSQL      stopped     port 5432"
    fi

    # Redis
    if is_redis_running; then
        status_icon="${GREEN}●${NC}"
        echo -e "  ${status_icon}  Redis           running     port 6379"
    else
        status_icon="${RED}●${NC}"
        echo -e "  ${status_icon}  Redis           stopped     port 6379"
    fi

    # Backend
    if is_backend_running; then
        status_icon="${GREEN}●${NC}"
        pid_info="PID $(cat "$BACKEND_PID")"
        echo -e "  ${status_icon}  Backend         running     port 8000   ${pid_info}"
    else
        status_icon="${RED}●${NC}"
        echo -e "  ${status_icon}  Backend         stopped     port 8000"
    fi

    # Frontend
    if is_frontend_running; then
        status_icon="${GREEN}●${NC}"
        pid_info="PID $(cat "$FRONTEND_PID")"
        echo -e "  ${status_icon}  Frontend        running     port 3000   ${pid_info}"
    else
        status_icon="${RED}●${NC}"
        echo -e "  ${status_icon}  Frontend        stopped     port 3000"
    fi

    # Ollama (Windows)
    local win_ip
    win_ip=$(get_windows_ip)
    if is_ollama_reachable; then
        status_icon="${GREEN}●${NC}"
        echo -e "  ${status_icon}  Ollama          running     port 11434  Windows: ${win_ip}"
    else
        status_icon="${YELLOW}●${NC}"
        echo -e "  ${status_icon}  Ollama          unknown     port 11434  Windows: ${win_ip}"
    fi

    echo ""
}
