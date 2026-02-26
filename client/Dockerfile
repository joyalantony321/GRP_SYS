FROM node:20-alpine

WORKDIR /app

# Accept build argument for API URL
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1 \
	CI=true \
	UV_THREADPOOL_SIZE=1 \
	npm_config_jobs=1 \
	npm_config_audit=false \
	npm_config_fund=false \
	npm_config_update_notifier=false \
	npm_config_progress=false

COPY package*.json ./

RUN npm install --foreground-scripts --no-audit --no-fund --prefer-offline

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
