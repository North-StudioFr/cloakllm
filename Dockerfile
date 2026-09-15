# Production multi-stage Dockerfile for CloakLLM
FROM node:20-alpine AS runner

WORKDIR /app

# Install dependencies and project code
COPY package.json ./
COPY bin/ ./bin/
COPY src/ ./src/

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

EXPOSE 8080

ENTRYPOINT ["node", "--experimental-strip-types", "src/cli.ts"]
CMD ["-h", "0.0.0.0", "-p", "8080"]
