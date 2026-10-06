# Updater (server.py): klient Dockera z wtyczką compose i Python do małego serwera, który go wywołuje.
FROM docker:cli
RUN apk add --no-cache python3
WORKDIR /app
COPY server.py .
CMD ["python3", "-u", "server.py"]
