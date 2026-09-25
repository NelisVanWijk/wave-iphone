FROM node:24-alpine
LABEL org.opencontainers.image.source="https://github.com/NelisVanWijk/wave-iphone"
LABEL org.opencontainers.image.description="Independent iPhone web player for SUB/WAVE"
WORKDIR /app
ENV NODE_ENV=production PORT=7780
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node public ./public
USER node
EXPOSE 7780
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD node -e "fetch('http://127.0.0.1:7780/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
