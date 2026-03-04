# Stage 1: Whisper.cpp bauen
FROM node:20-bookworm AS whisper-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    curl \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git . \
  && cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  && cmake --build build -j$(nproc) --config Release

# Modell large-v3-turbo (q8_0 = ~834MB, gute Qualität)
RUN mkdir -p models \
  && curl -L -o models/ggml-large-v3-turbo.bin \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"

# Stage 2: Finales Image
FROM node:20-bookworm

# Systemtools + ffmpeg, yt-dlp
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    yt-dlp \
    ca-certificates \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Whisper aus Stage 1
COPY --from=whisper-builder /build/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper-builder /build/models/ggml-large-v3-turbo.bin /opt/whisper/models/ggml-large-v3-turbo.bin

ENV WHISPER_MODEL_PATH=/opt/whisper/models/ggml-large-v3-turbo.bin \
    PORT=3003 \
    HOST=0.0.0.0

WORKDIR /app

# Abhängigkeiten (Lockfile nutzen falls vorhanden)
COPY package*.json ./
RUN npm ci 2>/dev/null || npm install

# App-Code
COPY . .

# Standard-Port
EXPOSE 3003

CMD ["npm", "start"]
