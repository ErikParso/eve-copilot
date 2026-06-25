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

# Build the frontend using the Hugging Face secret mount
RUN --mount=type=secret,id=VITE_EVE_CLIENT_ID,mode=0444,required=true \
    --mount=type=secret,id=VITE_ADSENSE_CLIENT_ID,mode=0444,required=false \
    --mount=type=secret,id=VITE_ADSENSE_DESKTOP_SLOT_ID,mode=0444,required=false \
    --mount=type=secret,id=VITE_ADSENSE_MOBILE_SLOT_ID,mode=0444,required=false \
    VITE_EVE_CLIENT_ID=$(cat /run/secrets/VITE_EVE_CLIENT_ID) \
    VITE_ADSENSE_CLIENT_ID=$( [ -f /run/secrets/VITE_ADSENSE_CLIENT_ID ] && cat /run/secrets/VITE_ADSENSE_CLIENT_ID || echo "" ) \
    VITE_ADSENSE_DESKTOP_SLOT_ID=$( [ -f /run/secrets/VITE_ADSENSE_DESKTOP_SLOT_ID ] && cat /run/secrets/VITE_ADSENSE_DESKTOP_SLOT_ID || echo "" ) \
    VITE_ADSENSE_MOBILE_SLOT_ID=$( [ -f /run/secrets/VITE_ADSENSE_MOBILE_SLOT_ID ] && cat /run/secrets/VITE_ADSENSE_MOBILE_SLOT_ID || echo "" ) \
    npm run build

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
