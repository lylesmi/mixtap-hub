FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
RUN mkdir -p /var/data && chown -R node:node /app /var/data
USER node
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 MIXTAP_DATA_DIR=/var/data MIXTAP_PUBLIC_ORIGIN=https://mixtap.ljas.ca
EXPOSE 8787
CMD ["node", "server.mjs"]
