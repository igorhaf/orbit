#!/bin/sh
# Database initialization script for PostgreSQL
# This script runs automatically when the container is first created

set -e

echo "🔧 Initializing database..."

# Wait a moment for PostgreSQL to be fully ready
sleep 2

# The database is automatically created by POSTGRES_DB environment variable
# This script is just for additional setup if needed

# Create database if it doesn't exist (redundant but safe)
psql -v ON_ERROR_STOP=0 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    SELECT 'CREATE DATABASE ai_orchestrator'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ai_orchestrator')\gexec
EOSQL

# Grant privileges
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    GRANT ALL PRIVILEGES ON DATABASE ai_orchestrator TO $POSTGRES_USER;
EOSQL

echo "✅ Database initialization complete!"
echo "   Database: ai_orchestrator"
echo "   User: $POSTGRES_USER"
