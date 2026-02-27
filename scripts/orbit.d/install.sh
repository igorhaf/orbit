# =============================================================================
# ORBIT Install Module
# =============================================================================

cmd_install() {
    header "ORBIT Install - Native WSL2 Dependencies"

    # Detect distro
    if [[ ! -f /etc/os-release ]]; then
        error "Cannot detect Linux distribution. Only Ubuntu/Debian supported."
        exit 1
    fi
    source /etc/os-release
    if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
        warn "Detected $ID - this script is optimized for Ubuntu/Debian. Proceeding anyway..."
    fi

    info "Updating package lists..."
    sudo_run apt-get update -qq

    # -- PostgreSQL 16 --------------------------------------------------------
    header "PostgreSQL 16 + pgvector"
    if command -v psql >/dev/null 2>&1 && psql --version 2>/dev/null | grep -q "16"; then
        success "PostgreSQL 16 already installed"
    else
        info "Adding PostgreSQL APT repository..."
        sudo_run apt-get install -y -qq curl ca-certificates gnupg lsb-release >/dev/null
        curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo_run gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg 2>/dev/null
        echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | sudo_run tee /etc/apt/sources.list.d/pgdg.list >/dev/null
        sudo_run apt-get update -qq
        info "Installing PostgreSQL 16..."
        sudo_run apt-get install -y -qq postgresql-16 postgresql-client-16 >/dev/null
        success "PostgreSQL 16 installed"
    fi

    # pgvector extension
    if dpkg -l 2>/dev/null | grep -q "postgresql-16-pgvector"; then
        success "pgvector extension already installed"
    else
        info "Installing pgvector extension..."
        sudo_run apt-get install -y -qq postgresql-16-pgvector >/dev/null
        success "pgvector extension installed"
    fi

    # -- Redis 7 --------------------------------------------------------------
    header "Redis"
    if command -v redis-server >/dev/null 2>&1; then
        success "Redis already installed ($(redis-server --version | awk '{print $3}'))"
    else
        info "Installing Redis..."
        sudo_run apt-get install -y -qq redis-server >/dev/null
        success "Redis installed"
    fi

    # -- Python 3.11 ----------------------------------------------------------
    header "Python 3.11"
    if command -v python3.11 >/dev/null 2>&1; then
        success "Python 3.11 already installed"
    else
        info "Installing Python 3.11..."
        sudo_run apt-get install -y -qq software-properties-common >/dev/null
        sudo_run add-apt-repository -y ppa:deadsnakes/ppa >/dev/null 2>&1
        sudo_run apt-get update -qq
        sudo_run apt-get install -y -qq python3.11 python3.11-venv python3.11-dev >/dev/null
        success "Python 3.11 installed"
    fi

    # -- pip & Poetry ---------------------------------------------------------
    header "Poetry"
    if command -v poetry >/dev/null 2>&1; then
        success "Poetry already installed ($(poetry --version 2>/dev/null))"
    else
        info "Installing Poetry..."
        curl -sSL https://install.python-poetry.org | python3.11 - >/dev/null 2>&1
        export PATH="$HOME/.local/bin:$PATH"
        success "Poetry installed"
    fi

    # -- Node.js 20 -----------------------------------------------------------
    header "Node.js 20"
    if command -v node >/dev/null 2>&1 && node --version 2>/dev/null | grep -q "^v2[0-9]"; then
        success "Node.js already installed ($(node --version))"
    else
        info "Installing Node.js 20 via NodeSource..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo_run bash - >/dev/null 2>&1
        sudo_run apt-get install -y -qq nodejs >/dev/null
        success "Node.js $(node --version) installed"
    fi

    # -- System libraries -----------------------------------------------------
    header "System Libraries"
    info "Installing system dependencies..."
    sudo_run apt-get install -y -qq gcc g++ libmagic1 libpq-dev git wget unzip >/dev/null
    success "System dependencies installed"

    # -- Summary --------------------------------------------------------------
    header "Installation Summary"
    echo -e "  PostgreSQL:  $(psql --version 2>/dev/null | head -1)"
    echo -e "  pgvector:    $(dpkg -l 2>/dev/null | grep pgvector | awk '{print $3}' | head -1)"
    echo -e "  Redis:       $(redis-server --version 2>/dev/null | awk '{print $3}')"
    echo -e "  Python:      $(python3.11 --version 2>/dev/null)"
    echo -e "  Poetry:      $(poetry --version 2>/dev/null)"
    echo -e "  Node.js:     $(node --version 2>/dev/null)"
    echo -e "  npm:         $(npm --version 2>/dev/null)"
    echo ""
    success "All dependencies installed! Run ${BOLD}orbit setup${NC} next."
}
