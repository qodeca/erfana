# SPDX-License-Identifier: GPL-3.0-only
# SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
#
# Headless Linux image for the Playwright Electron suite (run under xvfb).
# Built for the host's native architecture (arm64 on Apple Silicon, amd64 elsewhere).
# Driven by scripts/e2e-linux.sh – see docs/testing/e2e-testing.md.
FROM node:24-bookworm AS node

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# Electron/Chromium runtime libraries, xvfb, real shells (terminal tests need a
# prompt), git, Python 3.12 + toolchain for node-pty, and a few fonts.
# openbox is a minimal window manager: without one no window gets keyboard focus
# (Monaco hides its cursor) and window resize/maximize requests are ignored.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl xvfb xauth x11-utils openbox dbus dbus-x11 \
      libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libgbm1 \
      libgtk-3-0t64 libasound2t64 libxss1 libxtst6 libxkbcommon0 libx11-xcb1 \
      libxcomposite1 libxdamage1 libxrandr2 libxfixes3 libpango-1.0-0 libcairo2 \
      libglib2.0-0t64 libsecret-1-0 libnotify4 xdg-utils \
      fonts-liberation fonts-noto-color-emoji fonts-dejavu-core \
      zsh bash git openssh-client rsync \
      python3.12 python3-setuptools make g++ pkg-config \
    && ln -sf /usr/bin/python3.12 /usr/local/bin/python3 \
    && ln -sf /usr/bin/python3.12 /usr/local/bin/python \
    && rm -rf /var/lib/apt/lists/*

# Node 24 from the official image (same major as the app's development target).
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# ERFANA_E2E_FAST_SHELL tests exec into /bin/sh -i. On macOS that is bash, which
# starts slowly enough for the terminal's clear handshake to finish first; Ubuntu's
# dash draws its prompt before the clear and the clear then wipes it. Match macOS.
RUN ln -sf bash /bin/sh

# zsh without a ~/.zshrc prints a first-run wizard instead of a prompt.
RUN touch /root/.zshrc

WORKDIR /work
CMD ["bash"]
