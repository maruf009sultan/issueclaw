# Enterprise Gitclaw Docker Image
# Supports Bun + Node + gh CLI for local testing and CI

FROM oven/bun:1.1-debian

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    gh \
    curl \
    jq \
    ripgrep \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock* package-lock.json* ./

# Install dependencies
RUN bun install --frozen-lockfile || bun install

# Copy source
COPY . .

# Initialize state directories
RUN mkdir -p state/issues state/sessions

# Set git identity
RUN git config --global user.name "gitclaw[bot]" && \
    git config --global user.email "gitclaw[bot]@users.noreply.github.com" && \
    git config --global --add safe.directory '*'

# Default environment
ENV GITCLAW_LOG_LEVEL=info
ENV GITCLAW_LOG_JSON=false

# Default command
CMD ["bun", "run", "src/cli.ts", "doctor"]
