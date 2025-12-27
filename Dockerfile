# RapidPay CLI Dockerfile
# Multi-stage build for the SATD analysis CLI tool

# Stage 1: Build
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run compile

# Stage 2: Production
FROM node:18-alpine AS production

WORKDIR /app

# Install git for repository analysis
RUN apk add --no-cache git

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy built files from builder stage
COPY --from=builder /app/out ./out

# Create output directory
RUN mkdir -p /output

# Set environment variables
ENV NODE_ENV=production
ENV NEO4J_URI=bolt://localhost:7687
ENV NEO4J_USER=neo4j
ENV NEO4J_PASSWORD=rapidpay123

# Default command - show help
CMD ["node", "/app/out/cli/index.js", "--help"]

