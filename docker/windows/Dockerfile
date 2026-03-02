FROM fedora:latest

# mingw64 cross-toolchain + pre-built Windows-target libraries
RUN dnf install -y --setopt=install_weak_deps=False \
    mingw64-gcc \
    mingw64-gcc-c++ \
    mingw64-harfbuzz \
    mingw64-freetype \
    mingw64-fontconfig \
    mingw64-openssl \
    mingw64-pkg-config \
    curl \
    gcc \
    && dnf clean all

# Install Rust via rustup (Fedora's packaged Rust does not include rustup)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
    sh -s -- -y --default-toolchain stable --no-modify-path

ENV PATH="/root/.cargo/bin:${PATH}"

RUN rustup target add x86_64-pc-windows-gnu

WORKDIR /app
COPY . .

# Tell cargo which linker / archiver to use for the Windows GNU target
RUN mkdir -p .cargo && \
    printf '[target.x86_64-pc-windows-gnu]\nlinker = "x86_64-w64-mingw32-gcc"\nar = "x86_64-w64-mingw32-ar"\n' \
    > .cargo/config.toml

# Point pkg-config at the mingw64 Windows-target .pc files
ENV PKG_CONFIG_PATH=/usr/x86_64-w64-mingw32/sys-root/mingw/lib/pkgconfig \
    PKG_CONFIG_ALLOW_CROSS=1 \
    CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc

RUN cargo build --release \
    --target x86_64-pc-windows-gnu \
    --manifest-path daemon/Cargo.toml

CMD ["/bin/sh", "-c", \
    "mkdir -p /output && \
     cp /app/daemon/target/x86_64-pc-windows-gnu/release/latex-daemon.exe /output/latex-daemon.exe && \
     echo 'Binary written to /output/latex-daemon.exe'"]
