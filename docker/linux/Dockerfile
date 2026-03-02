### Builder stage ####################################################
FROM rust:alpine AS builder

# System deps — static variants included for a fully-static output binary
RUN apk add --no-cache \
    bash \
    g++ \
    musl-dev \
    pkgconf \
    harfbuzz-dev \
    harfbuzz-static \
    freetype-dev \
    freetype-static \
    fontconfig-dev \
    fontconfig-static \
    openssl-dev \
    openssl-libs-static \
    zlib-static \
    bzip2-dev \
    bzip2-static \
    expat-dev \
    expat-static \
    libpng-dev \
    libpng-static \
    brotli-dev \
    brotli-static

# Ensure /usr/bin/c++ exists (cxx_wrapper calls it directly)
RUN ln -sf "$(which g++)" /usr/bin/c++ || true

# Copy the C++ standard upgrade wrapper (guards against ICU 75+ / -std=c++14 clash)
COPY daemon/scripts/cxx_wrapper /usr/local/bin/cxx_wrapper
RUN chmod +x /usr/local/bin/cxx_wrapper

WORKDIR /app
COPY . .

# Build statically: crt-static + PKG_CONFIG_ALL_STATIC force-links every C dep
ENV CXX=/usr/local/bin/cxx_wrapper \
    PKG_CONFIG_ALL_STATIC=1 \
    RUSTFLAGS="-C target-feature=+crt-static"

RUN cargo build --release --manifest-path daemon/Cargo.toml

### Output stage #####################################################
# Minimal Alpine image whose only job is to copy the binary on `docker run`
FROM alpine:3

COPY --from=builder /app/daemon/target/release/latex-daemon /latex-daemon

CMD ["/bin/sh", "-c", "mkdir -p /output && cp /latex-daemon /output/latex-daemon && echo 'Binary written to /output/latex-daemon'"]
