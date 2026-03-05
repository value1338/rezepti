# Rezepti — ffmpeg, yt-dlp, whisper-cpp (CUDA + CPU-Fallback)
# GPU: Mit --gpus all oder NVIDIA_VISIBLE_DEVICES starten.

# Stage 1a: Whisper.cpp mit CUDA bauen
ARG CUDA_VERSION=12.4.1
FROM nvidia/cuda:${CUDA_VERSION}-devel-ubuntu22.04 AS whisper-builder-gpu

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git curl \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git . \
  && cmake -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF \
    -DGGML_CUDA=ON \
    -DCMAKE_CUDA_ARCHITECTURES="75;80;86;90" \
  && cmake --build build -j$(nproc) --config Release

# Modell large-v3-turbo
RUN mkdir -p models \
  && curl -L -o models/ggml-large-v3-turbo.bin \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"

# Stage 1b: Whisper.cpp ohne CUDA (CPU-Fallback)
FROM ubuntu:22.04 AS whisper-builder-cpu

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git ca-certificates \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git . \
  && cmake -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF \
    -DGGML_CUDA=OFF \
  && cmake --build build -j$(nproc) --config Release

# Stage 2: Runtime mit CUDA + Node.js
ARG CUDA_VERSION=12.4.1
FROM nvidia/cuda:${CUDA_VERSION}-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
  && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get install -y nodejs \
  && curl -L -o /usr/local/bin/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" \
  && chmod +x /usr/local/bin/yt-dlp \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Beide Binaries + Modell kopieren
COPY --from=whisper-builder-gpu /build/build/bin/whisper-cli /usr/local/bin/whisper-cli-gpu
COPY --from=whisper-builder-cpu /build/build/bin/whisper-cli /usr/local/bin/whisper-cli-cpu
COPY --from=whisper-builder-gpu /build/models/ggml-large-v3-turbo.bin /opt/whisper/models/ggml-large-v3-turbo.bin

# Wrapper: versucht GPU-Binary, fällt bei libcuda-Fehler auf CPU zurück
RUN printf '#!/bin/sh\nif /usr/local/bin/whisper-cli-gpu "$@" 2>/tmp/whisper-gpu-err; then\n  exit 0\nfi\nif grep -q "libcuda\|shared libraries" /tmp/whisper-gpu-err 2>/dev/null; then\n  echo "[whisper] GPU nicht verfügbar, CPU-Fallback" >&2\n  exec /usr/local/bin/whisper-cli-cpu "$@"\nfi\ncat /tmp/whisper-gpu-err >&2\nexit 1\n' > /usr/local/bin/whisper-cli \
  && chmod +x /usr/local/bin/whisper-cli

ENV WHISPER_MODEL_PATH=/opt/whisper/models/ggml-large-v3-turbo.bin \
    PORT=3003 \
    HOST=0.0.0.0

WORKDIR /app

COPY package*.json ./
RUN npm ci 2>/dev/null || npm install

COPY . .

EXPOSE 3003

ENTRYPOINT []
CMD ["npm", "start"]
