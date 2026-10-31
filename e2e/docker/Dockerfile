# SPDX-License-Identifier: GPL-3.0-only
# SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
#
# Headless Linux image for the Playwright Electron suite (run under xvfb).
# Built for the host's native architecture (arm64 on Apple Silicon, amd64 elsewhere).
# Driven by scripts/e2e-linux.sh – see docs/testing/e2e-testing.md.
# node:24-bookworm
FROM node:24-bookworm@sha256:925de64a85319052d6971ae81ef2417da956e8a3a2c4a0fac732327970f017f5 AS node

# ubuntu:24.04
FROM ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# Electron/Chromium runtime libraries, xvfb, real shells (terminal tests need a
# prompt), git, Python 3.12 + toolchain for node-pty, and a few fonts.
# openbox is a minimal window manager: without one no window gets keyboard focus
# (Monaco hides its cursor) and window resize/maximize requests are ignored.
# xdotool parks the real X pointer in a corner (run-under-xvfb.sh).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates xvfb xauth x11-utils openbox xdotool dbus dbus-x11 \
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

# The suite runs as the host user (no passwd entry) with HOME=/tmp/home. zsh without a
# ~/.zshrc prints a first-run wizard instead of a prompt, so give it an empty one.
RUN mkdir -p /tmp/home/.npm && touch /tmp/home/.zshrc && chmod -R a+rwX /tmp/home

WORKDIR /work
CMD ["bash"]
