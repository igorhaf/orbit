# Backend Dockerfile - FastAPI with Python 3.11
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies + provisioning tools (PHP, Composer, Node, npm)
# PHP and Composer are needed for Laravel provisioning
# Node and npm are needed for Next.js provisioning
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    libmagic1 \
    curl \
    wget \
    git \
    unzip \
    # PHP CLI and extensions for Laravel (using default Debian PHP)
    php-cli \
    php-curl \
    php-mbstring \
    php-xml \
    php-zip \
    php-pgsql \
    # Node.js and npm for Next.js (using default Debian Node)
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install Composer for Laravel dependency management
RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer \
    && composer --version

# Install Poetry
RUN pip install --no-cache-dir poetry==1.7.1

# Copy poetry files
COPY backend/pyproject.toml backend/poetry.lock* ./

# Configure Poetry to not create virtual environment (we're in a container)
RUN poetry config virtualenvs.create false

# Update lock file and install dependencies
RUN poetry lock --no-update && \
    poetry install --no-interaction --no-ansi --no-root

# Copy application code
COPY backend/ ./

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health')" || exit 1

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
