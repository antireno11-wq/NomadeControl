FROM node:18-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:18-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
# Despues de guardar un formulario, Next se pide la pagina de destino a si
# mismo en "localhost". El servidor escucha solo en IPv4 (0.0.0.0), pero Node
# resuelve "localhost" primero a la direccion IPv6 (::1), y la llamada fallaba
# con ECONNREFUSED en cada guardado. Next caia a una redireccion normal -el
# usuario llegaba igual-, pero con un viaje extra y una traza de error por
# cada formulario que tapaba los errores de verdad en los registros.
ENV NODE_OPTIONS="--dns-result-order=ipv4first"
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/start.sh ./start.sh
RUN chmod +x start.sh
EXPOSE 3000
CMD ["sh", "start.sh"]
