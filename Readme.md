# ElderPing Auth Service

## Overview

The Auth Service is a Node.js-based microservice responsible for user authentication and authorization in the ElderPing platform. It handles user registration, login, JWT token generation/validation, and family link management.

## Technology Stack

- **Runtime**: Node.js 18
- **Framework**: Express.js
- **Database**: PostgreSQL
- **Authentication**: JWT (JSON Web Tokens)
- **Container**: Docker (multi-stage build with Alpine Linux)
- **Security**: Non-root user execution (USER node)

## Features

- User registration with invite codes
- User login with JWT token generation
- JWT token validation for protected routes
- Family link management (connect family members to elders)
- Role-based access control (family, elder)
- Password hashing with bcrypt
- Health check endpoint for monitoring

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `POST /api/auth/validate` - Validate JWT token

### User Management
- `GET /api/auth/user/:id` - Get user by ID
- `PUT /api/auth/user/:id` - Update user profile
- `DELETE /api/auth/user/:id` - Delete user

### Family Links
- `POST /api/auth/family/link` - Link family member to elder
- `GET /api/auth/family/:userId` - Get family links for user
- `DELETE /api/auth/family/:linkId` - Remove family link

### Health
- `GET /health` - Health check endpoint

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DB_HOST` | PostgreSQL database host | Yes |
| `DB_PORT` | PostgreSQL database port | Yes |
| `DB_USER` | PostgreSQL username | Yes |
| `DB_PASSWORD` | PostgreSQL password | Yes |
| `DB_NAME` | Database name (users_db) | Yes |
| `JWT_SECRET` | Secret key for JWT signing | Yes |
| `PORT` | Service port (default: 3000) | No |

## Database Schema

### Users Table
```sql
CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  username   VARCHAR(50) UNIQUE NOT NULL,
  password   VARCHAR(255) NOT NULL,
  role       VARCHAR(20) DEFAULT 'family',
  invite_code VARCHAR(10) UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Family Links Table
```sql
CREATE TABLE family_links (
  id         SERIAL PRIMARY KEY,
  family_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  elder_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(family_id, elder_id)
);
```

## Docker Image

- **Repository**: `arunnsimon/elderpinq-auth-service`
- **Tags**: 
  - `dev-latest` - Development builds from develop branch
  - `prod-latest` - Production builds from main branch
  - `<version>` - Release tags

## CI/CD Pipeline

The service uses GitHub Actions for continuous integration and deployment:

1. **Security Scanning**
   - SAST (Static Application Security Testing)
   - SCA (Software Composition Analysis)
   - Trivy vulnerability scanning

2. **Docker Build & Publish**
   - Multi-stage Docker build
   - Push to Docker Hub
   - Tagged based on branch (dev-latest/prod-latest)

3. **GitOps Deployment**
   - Updates Helm chart image tag in elderping-k8s-charts
   - ArgoCD automatically syncs changes

## Kubernetes Deployment

### Helm Chart
Located in `elderping-k8s-charts/microservices/auth-service/`

**Resources:**
- Deployment with 2 replicas
- Service (ClusterIP on port 3000)
- HorizontalPodAutoscaler (2-5 replicas, 80% CPU target)

**Configuration:**
- Namespace: elderping-dev (dev) / elderping-prod (prod)
- Resource requests: 100m CPU, 128Mi memory
- Resource limits: 500m CPU, 256Mi memory
- Liveness/Readiness probes on /health endpoint

## Security Features

- **Non-root container**: Runs as `node` user (not root)
- **Password hashing**: Uses bcrypt for secure password storage
- **JWT tokens**: Signed with secret key, configurable expiration
- **Environment variables**: Sensitive data via Kubernetes Secrets
- **Network policies**: Restricts ingress/egress traffic (when enabled)

## Development

### Local Setup
```bash
# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your values

# Run development server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

### Docker Build
```bash
# Build image
docker build -t elderping-auth-service .

# Run container
docker run -p 3000:3000 --env-file .env elderping-auth-service
```

## Monitoring

- **Health Check**: `GET /health` returns service status
- **Metrics**: Exposed for Prometheus scraping
- **Logs**: Collected by Loki
- **Dashboards**: Grafana dashboards for monitoring

## Troubleshooting

### Common Issues

**Database Connection Failed**
- Verify DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
- Check PostgreSQL is accessible from the pod
- Verify network policies allow database access

**JWT Validation Failed**
- Verify JWT_SECRET is set correctly
- Check token hasn't expired
- Ensure token is sent in Authorization header

**Container Not Starting**
- Check pod logs: `kubectl logs <pod-name> -n elderping-dev`
- Verify resource limits are sufficient
- Check liveness probe configuration

## Contributing

1. Create feature branch from develop
2. Make changes and test locally
3. Commit with descriptive message
4. Push to feature branch
5. Create pull request to develop

## License

Proprietary - ElderPing Platform