# Stage 1: Frontend build
FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Final image
FROM python:3.12-slim-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    rmlint \
    rsync \
    supervisor \
    tini \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install fclones — multi-threaded duplicate finder (uses all CPU cores)
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then \
      curl -fsSL "https://github.com/pkolaczk/fclones/releases/download/v0.35.0/fclones-0.35.0-linux-glibc-x86_64.tar.gz" -o /tmp/fclones.tar.gz; \
    elif [ "$ARCH" = "arm64" ]; then \
      curl -fsSL "https://github.com/pkolaczk/fclones/releases/download/v0.35.0/fclones-0.35.0-linux-glibc-aarch64.tar.gz" -o /tmp/fclones.tar.gz; \
    fi && tar xzf /tmp/fclones.tar.gz -C / && rm /tmp/fclones.tar.gz \
    || echo "WARNING: fclones installation failed, continuing without it"

# Install Python dependencies
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY backend/ ./backend/

# Copy frontend build
COPY --from=frontend /app/frontend/dist ./backend/static/

# Copy Docker configs
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV PYTHONPATH=/app/backend
ENV COLLECTIVE_CONFIG_DIR=/data
ENV COLLECTIVE_DATA_DIR=/data
ENV COLLECTIVE_DATABASE_URL=sqlite+aiosqlite:////data/collective.db

EXPOSE 8080
VOLUME ["/data"]

ENTRYPOINT ["tini", "--"]
CMD ["/entrypoint.sh"]
