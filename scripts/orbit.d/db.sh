# =============================================================================
# ORBIT Database Commands Module
# =============================================================================

cmd_db_migrate() {
    header "Database Migration"

    if ! is_pg_running; then
        info "Starting PostgreSQL first..."
        start_postgres
    fi

    info "Running alembic upgrade head..."
    cd "${BACKEND_DIR}"

    if [[ -f "${ORBIT_ROOT}/.env" ]]; then
        set -a
        source "${ORBIT_ROOT}/.env"
        set +a
    fi

    poetry run alembic upgrade head
    success "Migrations applied"
}

cmd_db_reset() {
    header "Database Reset"
    warn "This will DROP and recreate the '${DB_NAME}' database!"
    echo -n "  Are you sure? (y/N): "
    read -r confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        info "Cancelled"
        return
    fi

    if ! is_pg_running; then
        start_postgres
    fi

    if is_backend_running; then
        stop_backend
    fi

    info "Dropping database '${DB_NAME}'..."
    sudo_run -u postgres psql -c "DROP DATABASE IF EXISTS ${DB_NAME};" 2>/dev/null
    success "Database dropped"

    info "Creating database '${DB_NAME}'..."
    sudo_run -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" 2>/dev/null
    success "Database created"

    info "Enabling pgvector..."
    sudo_run -u postgres psql -d "${DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null
    success "pgvector enabled"

    info "Running migrations..."
    cd "${BACKEND_DIR}"
    if [[ -f "${ORBIT_ROOT}/.env" ]]; then
        set -a
        source "${ORBIT_ROOT}/.env"
        set +a
    fi
    poetry run alembic upgrade head
    success "Database reset complete"
}
