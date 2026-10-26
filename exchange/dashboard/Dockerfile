# Stage 1: Build
FROM node:20.19.0-alpine AS builder

WORKDIR /app

# Copy the local kiao-style dependency
COPY reference/kiao-style/package.json ./reference/kiao-style/
COPY reference/kiao-style/dist ./reference/kiao-style/dist
COPY reference/kiao-style/index.d.ts ./reference/kiao-style/
# Copy the local kiao-worker dependency
COPY reference/kiao-worker/package.json ./reference/kiao-worker/
COPY reference/kiao-worker/dist ./reference/kiao-worker/dist

# Copy Dashboard source files
COPY exchange/dashboard ./

# Fix the dependency paths in package.json for Docker build
RUN sed -i 's|file:../../reference/kiao-style|file:./reference/kiao-style|g' package.json

RUN sed -i 's|file:../../reference/kiao-worker|file:./reference/kiao-worker|g' package.json

# Remove lock files to allow fresh install
RUN rm -rf node_modules package-lock.json

# Install dependencies
RUN npm install

# Define build arguments
ARG VITE_WORKER_URL
ENV VITE_WORKER_URL=$VITE_WORKER_URL

ARG VITE_PLANTUML_SERVER_URL
ENV VITE_PLANTUML_SERVER_URL=$VITE_PLANTUML_SERVER_URL

# Build the application
RUN npm run build

# Stage 2: Production
FROM nginx:1.27.0-alpine

# Copy built application
COPY --from=builder /app/build /usr/share/nginx/html

# Patch mime.types to support mjs as application/javascript
RUN sed -i '/application\/javascript/ s/js;/js mjs;/' /etc/nginx/mime.types

# Copy nginx config for React items (SPA)
# We need to ensure that routes are handled correctly by index.html
RUN echo 'server { \
    listen 80; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
        add_header Cache-Control "no-store, no-cache, must-revalidate"; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
