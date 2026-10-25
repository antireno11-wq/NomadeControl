# syntax=docker/dockerfile:1
# Imagen base fijada por digest (python 3.12-slim).
FROM python:3.12-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704 AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app/src
WORKDIR /app
RUN useradd --create-home --uid 10001 radar
# Dependencias fijadas con hashes (generadas con `uv export`).
# Redes con inspección TLS (proxy corporativo): pasar la CA como secreto de build
#   docker build --secret id=extra_ca,src=/ruta/ca.pem .
# Sin el secreto, el build es el estándar.
COPY requirements.lock ./
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export PIP_CERT=/run/secrets/extra_ca; fi; \
    pip install --require-hashes -r requirements.lock

FROM base AS runtime
COPY alembic.ini pyproject.toml README.md ./
COPY migrations ./migrations
COPY src ./src
USER radar
EXPOSE 8000 8501
CMD ["python", "-m", "radar.cli", "api", "--host", "0.0.0.0", "--port", "8000"]

FROM runtime AS dev
USER root
COPY requirements-dev.lock ./
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export PIP_CERT=/run/secrets/extra_ca; fi; \
    pip install --require-hashes -r requirements-dev.lock
COPY tests ./tests
USER radar
CMD ["python", "-m", "pytest", "-q"]
