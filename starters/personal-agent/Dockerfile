FROM docker.io/cloudflare/sandbox:0.10.1-python

RUN npm install -g typescript ts-node prettier && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      gawk \
      jq \
      ripgrep \
      rsync \
      shellcheck && \
    rm -rf /var/lib/apt/lists/*
