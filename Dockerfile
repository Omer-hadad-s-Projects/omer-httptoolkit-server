# Multi-stage Dockerfile for building and running httptoolkit-server
# Builder stage: install dependencies and compile TypeScript
FROM node:22.20.0-bullseye-slim AS builder
WORKDIR /usr/src/app

# Install minimal build deps needed for some native modules
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy lockfile and package manifest first for better caching
COPY package.json package-lock.json tsconfig.json ./

# Copy the rest of the repository
COPY . .

# Install all deps (including dev) so we can build the project
RUN npm ci --unsafe-perm

# Build compiled JS output used by the CLI
RUN npm run build:src

# Production image: copy only runtime artifacts
FROM node:22.20.0-bullseye-slim
WORKDIR /usr/src/app

# Ensure certificates are available in the runtime image and install ADB tools
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates android-tools-adb \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install only production dependencies
COPY --from=builder /usr/src/app/package.json ./
COPY --from=builder /usr/src/app/package-lock.json ./
# Copy node_modules installed in the builder (production deps will be present)
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copy built JS, CLI entry point and any runtime assets the server uses
COPY --from=builder /usr/src/app/lib ./lib
COPY --from=builder /usr/src/app/bin ./bin
COPY --from=builder /usr/src/app/overrides ./overrides
COPY --from=builder /usr/src/app/nss ./nss


ENV NODE_ENV=production

# The server binds to localhost ports 45456 (mockttp) and 45457 (API)
EXPOSE 45456 45457

# Run as the official non-root 'node' user
USER node

# Default command: start the oclif CLI with the 'start' command
CMD ["node", "./bin/run", "start"]
