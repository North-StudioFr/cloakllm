FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package.json tsconfig.json ./

# Copy application source code
COPY src/ ./src/
COPY bin/ ./bin/

# Expose default proxy port
EXPOSE 8080

# Environment defaults
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

# Start CloakLLM proxy
ENTRYPOINT ["node", "--experimental-strip-types", "src/cli.ts"]
CMD ["-h", "0.0.0.0", "-p", "8080"]
