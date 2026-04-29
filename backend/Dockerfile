FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src/ ./src/
COPY scripts/ ./scripts/

RUN mkdir -p /app/uploads

EXPOSE 3000

CMD ["node", "src/app.js"]
