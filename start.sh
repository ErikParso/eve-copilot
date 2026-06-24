#!/bin/sh

# Start the Node.js Express backend in the background
cd /app/server
node --max-old-space-size=1536 dist/index.js &

# Start Nginx in the foreground
nginx -c /etc/nginx/nginx.conf
