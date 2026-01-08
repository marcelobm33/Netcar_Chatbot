# Dockerfile para Deploy Standalone (Pre-built)
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# O pacote zip extraído já contém server.js, public/, .next/static e node_modules/ na raiz.
# Copiamos tudo para a imagem.
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
