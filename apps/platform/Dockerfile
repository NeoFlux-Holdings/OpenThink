FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  ca-certificates \
  git \
  openssh-client \
  python3 \
  python3-pip \
  ripgrep \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
ENV SHELL=/bin/bash
EXPOSE 8080

CMD ["/bin/bash", "-lc", "while true; do sleep 3600; done"]
