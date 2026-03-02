### Builder stage ####################################################
FROM rust:bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    pkg-config \
    libharfbuzz-dev \
    libfreetype-dev \
    libfontconfig-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy the C++ standard upgrade wrapper (guards against ICU 75+ / -std=c++14 clash)
COPY daemon/scripts/cxx_wrapper /usr/local/bin/cxx_wrapper
RUN chmod +x /usr/local/bin/cxx_wrapper

WORKDIR /app
COPY . .

ENV CXX=/usr/local/bin/cxx_wrapper

RUN cargo build --release --manifest-path daemon/Cargo.toml

### Run stage ########################################################
# Used both to run the daemon directly and to extract the binary.
# Requires glibc 2.36+ (Debian 12 / Ubuntu 22.04+).
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libharfbuzz0b \
    libfreetype6 \
    libfontconfig1 \
    libssl3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/daemon/target/release/latex-daemon /usr/local/bin/latex-daemon

EXPOSE 7878
# The TeX bundle (~500 MB) is downloaded on first compile and cached here.
VOLUME ["/root/.cache/Tectonic"]

ENTRYPOINT ["/usr/local/bin/latex-daemon"]
