FROM node:20-alpine

# Install Nginx
RUN apk add --no-cache nginx

WORKDIR /app

# Copy all source files
COPY . .

# Build the Backend
WORKDIR /app/server
RUN npm ci
RUN npm run build

# Build the Frontend (Vite)
WORKDIR /app/web
RUN npm ci

# Read VITE_EVE_CLIENT_ID from Hugging Face Space secrets during build
ARG VITE_EVE_CLIENT_ID
ENV VITE_EVE_CLIENT_ID=$VITE_EVE_CLIENT_ID

RUN npm run build

# Set up Nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Set up startup entrypoint
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Hugging Face Spaces runs as user 1000, so we make sure the app directory is writable
RUN chown -R 1000:1000 /app /var/lib/nginx /var/log/nginx

# Run as non-root user (required by Hugging Face)
USER 1000

EXPOSE 7860

ENTRYPOINT ["/app/start.sh"]
