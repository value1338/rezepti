# Rezepti — ffmpeg, yt-dlp, whisper-cpp (CUDA, CPU-Fallback)
# GPU: Mit --gpus all starten. Ohne GPU: automatischer CPU-Fallback.

# Stage 1: Whisper.cpp mit CUDA bauen
ARG CUDA_VERSION=12.4.1
FROM nvidia/cuda:${CUDA_VERSION}-devel-ubuntu22.04 AS whisper-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    curl \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

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

# Stage 2: Runtime mit CUDA + Node.js
ARG CUDA_VERSION=12.4.1
FROM nvidia/cuda:${CUDA_VERSION}-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    yt-dlp \
    ca-certificates \
    curl \
  && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get install -y nodejs \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Whisper (CUDA-build, CPU-Fallback wenn keine GPU) + Modell
COPY --from=whisper-builder /build/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper-builder /build/models/ggml-large-v3-turbo.bin /opt/whisper/models/ggml-large-v3-turbo.bin

ENV WHISPER_MODEL_PATH=/opt/whisper/models/ggml-large-v3-turbo.bin \
    PORT=3003 \
    HOST=0.0.0.0

WORKDIR /app

COPY package*.json ./
RUN npm ci 2>/dev/null || npm install

COPY . .

EXPOSE 3003

CMD ["npm", "start"]
