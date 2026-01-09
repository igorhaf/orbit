# 🚀 ORBIT Project Provisioning System

Automated project scaffolding based on interview responses.

## 📖 Overview

This system automatically creates fully-configured projects with Docker Compose, based on the technology stack selected during the ORBIT interview process.

## 🛠️ Available Stacks

### 1. Laravel + PostgreSQL + Tailwind CSS

**Script:** `laravel_setup.sh`

**Stack:**
- Laravel 10.x (PHP 8.2)
- PostgreSQL 15
- Nginx
- Tailwind CSS 3.x
- Adminer (DB UI)

**Ports:**
- App: 8080
- Database: 5433
- Adminer: 8081

**Usage:**
```bash
cd backend/provisioning
./laravel_setup.sh my-laravel-project
cd ../../projects/my-laravel-project
./setup.sh
```

---

### 2. Next.js + PostgreSQL + Tailwind CSS

**Script:** `nextjs_setup.sh`

**Stack:**
- Next.js 14 (App Router)
- TypeScript
- PostgreSQL 15
- Prisma ORM
- Tailwind CSS 3.x
- Adminer (DB UI)

**Ports:**
- App: 3002
- Database: 5434
- Adminer: 8082

**Usage:**
```bash
cd backend/provisioning
./nextjs_setup.sh my-nextjs-project
cd ../../projects/my-nextjs-project
./setup.sh
```

---

### 3. FastAPI + React + PostgreSQL

**Script:** `fastapi_react_setup.sh`

**Stack:**
- FastAPI (Python 3.11)
- React 18 + TypeScript
- PostgreSQL 15
- SQLAlchemy + Alembic
- Tailwind CSS 3.x
- Adminer (DB UI)

**Ports:**
- Frontend: 3003
- Backend: 8001
- Database: 5435
- Adminer: 8083

**Usage:**
```bash
cd backend/provisioning
./fastapi_react_setup.sh my-fullstack-project
cd ../../projects/my-fullstack-project
./setup.sh
```

---

## 📁 Project Structure

All provisioned projects are created in:
```
orbit-2.1/projects/<project-name>/
```

**Important:** The `/projects/` directory is gitignored and not tracked in version control.

## 🔧 How It Works

### 1. Provisioning Phase

Each script:
1. ✅ Creates project directory structure
2. ✅ Generates `docker-compose.yml` with all services
3. ✅ Creates Dockerfile(s) for each component
4. ✅ Generates configuration files (nginx, php, etc.)
5. ✅ Creates `.env` file with database credentials
6. ✅ Generates `setup.sh` script for initial setup
7. ✅ Creates comprehensive `README.md`
8. ✅ Allocates ports that don't conflict with ORBIT

### 2. Setup Phase

The generated `setup.sh` script:
1. ✅ Installs framework/dependencies
2. ✅ Configures database connections
3. ✅ Sets up Tailwind CSS
4. ✅ Runs initial migrations
5. ✅ Builds Docker containers
6. ✅ Starts all services

### 3. Development Phase

Each project includes:
- 🐳 Full Docker Compose setup
- 📝 Complete README with commands
- 🗄️ Database management UI (Adminer)
- 🔄 Hot reload for development
- 🎨 Pre-configured Tailwind CSS
- 📦 Package management configured

## 🎯 Port Allocation Strategy

### ORBIT Core Services (Reserved)
- 3000: Frontend (Next.js)
- 3001: Grafana
- 5432: PostgreSQL
- 6379: Redis
- 6831: Jaeger Agent
- 8000: Backend (FastAPI)
- 9090: Prometheus
- 14268: Jaeger Collector
- 16686: Jaeger UI

### Provisioned Projects (Available)
- **Laravel:**
  - 8080: Nginx
  - 5433: PostgreSQL
  - 8081: Adminer

- **Next.js:**
  - 3002: Next.js App
  - 5434: PostgreSQL
  - 8082: Adminer

- **FastAPI + React:**
  - 3003: React Frontend
  - 8001: FastAPI Backend
  - 5435: PostgreSQL
  - 8083: Adminer

## 🔐 Security Notes

### Database Credentials

Each project generates unique, random credentials:
- Database name: `<project-name>`
- Username: `<project-name>_user`
- Password: Random 12-character base64 string

Credentials are saved in:
- Laravel: `.env` file
- Next.js: `.env.local` file
- FastAPI: `backend/.env` file

### Secret Keys

- Laravel: Auto-generated via `php artisan key:generate`
- Next.js: Not required (SSR)
- FastAPI: Random 32-character base64 string (for JWT)

## 📋 Common Tasks

### Start a Project
```bash
cd projects/<project-name>
docker-compose up -d
```

### View Logs
```bash
docker-compose logs -f
```

### Stop a Project
```bash
docker-compose down
```

### Rebuild Containers
```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Access Database
```bash
# Via Adminer (Web UI)
http://localhost:808X  # (X = 1, 2, or 3)

# Via CLI
docker-compose exec db psql -U <user> -d <database>
```

## 🧹 Cleanup

### Remove a Project
```bash
cd projects
rm -rf <project-name>
```

### Remove All Projects
```bash
rm -rf projects/*
```

### Remove Project Volumes
```bash
cd projects/<project-name>
docker-compose down -v  # Removes volumes (deletes database!)
```

## 🐛 Troubleshooting

### Port Conflicts

If you get port conflicts:
1. Check what's using the port:
   ```bash
   lsof -i :PORT_NUMBER
   ```

2. Stop conflicting service or edit `docker-compose.yml` to use different port

### Permission Issues (Laravel)

```bash
docker-compose exec app chown -R laravel:www-data /var/www/storage /var/www/bootstrap/cache
docker-compose exec app chmod -R 775 /var/www/storage /var/www/bootstrap/cache
```

### Database Connection Failed

1. Check if database is running:
   ```bash
   docker-compose ps db
   ```

2. Check database logs:
   ```bash
   docker-compose logs db
   ```

3. Verify credentials in `.env` file match `docker-compose.yml`

### Container Won't Start

```bash
# Check logs
docker-compose logs <service-name>

# Rebuild
docker-compose build --no-cache <service-name>
docker-compose up -d
```

## 📚 Additional Resources

### Laravel
- [Laravel Documentation](https://laravel.com/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [PostgreSQL](https://www.postgresql.org/docs/)

### Next.js
- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

### FastAPI + React
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [React Documentation](https://react.dev/)
- [SQLAlchemy](https://docs.sqlalchemy.org/)

## 🔄 Integration with ORBIT

### Automatic Provisioning (Future)

These scripts can be automatically triggered after the interview process:

```python
# In interview completion handler
if interview.status == "completed":
    stack = interview.get_stack_info()

    if stack.backend == "Laravel":
        subprocess.run(["./backend/provisioning/laravel_setup.sh", project.name])
    elif stack.backend == "FastAPI" and stack.frontend == "Next.js":
        subprocess.run(["./backend/provisioning/nextjs_setup.sh", project.name])
    elif stack.backend == "FastAPI" and stack.frontend == "React":
        subprocess.run(["./backend/provisioning/fastapi_react_setup.sh", project.name])
```

### API Endpoint (Future)

```python
@router.post("/api/v1/projects/{project_id}/provision")
async def provision_project(project_id: str, db: Session = Depends(get_db)):
    """
    Trigger automatic project provisioning based on interview responses
    """
    project = get_project(db, project_id)
    interview = get_latest_interview(db, project_id)

    # Determine stack from interview
    stack = extract_stack_from_interview(interview)

    # Provision project
    result = provision_project(project.name, stack)

    return {"success": True, "project_path": result.path}
```

## 🎨 Customization

Each generated project includes:
- ✅ Full Docker Compose configuration
- ✅ Development and production Dockerfiles
- ✅ Environment configuration
- ✅ Database setup and migrations
- ✅ Frontend styling (Tailwind CSS)
- ✅ Example models and routes
- ✅ Comprehensive README

You can customize:
- Port numbers (edit `docker-compose.yml`)
- Database settings (edit `.env`)
- Container configuration (edit `Dockerfile`)
- Application settings (edit framework config files)

## 📝 Notes

- All projects use **PostgreSQL** (not MySQL)
- All projects include **Tailwind CSS**
- All projects use **Docker Compose**
- All projects include **Adminer** for database management
- Database credentials are **randomly generated** for security
- Projects are **gitignored** (for testing only)

## 🚀 Future Enhancements

- [ ] Django + React setup script
- [ ] Express.js + Vue.js setup script
- [ ] Support for MongoDB instead of PostgreSQL
- [ ] Support for Bootstrap instead of Tailwind
- [ ] Automatic SSL certificate generation (Let's Encrypt)
- [ ] CI/CD pipeline templates (GitHub Actions, GitLab CI)
- [ ] Kubernetes deployment manifests
- [ ] Terraform infrastructure templates

---

**Generated by ORBIT - Intelligent Project Orchestration**
