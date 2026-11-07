#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
#
# Regenerates the TEST-ONLY certificates of the spec 025 browser fixtures.
# Every private key written here is public by design: it protects nothing and
# is trusted by nothing outside the e2e suite.
#
# Output (next to this script):
#   ca.pem / ca.key.pem                  test CA, 20 years
#   valid.pem / valid.key.pem            CA-signed, the *.test fixture hosts, 20 years
#   expired.pem / expired.key.pem        CA-signed, expired.test, expired in 2001
#   mismatch.pem / mismatch.key.pem      CA-signed for not-this-host.example, served on mismatch.test
#   selfsigned.pem / selfsigned.key.pem  self-signed (no CA), selfsigned.test, 20 years
#   selfsigned-b.pem / selfsigned-b.key.pem  a second self-signed certificate for the same
#                                        host, for the "host presents a new certificate" case
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash e2e/fixtures/browser/certs/generate.sh [--help] [OUT_DIR]

Writes every test certificate and key into OUT_DIR (default: this folder).
server/certs.ts runs it on first use into certs/generated/; the files are
git-ignored and never committed.
Needs OpenSSL 1.1.1 or later (LibreSSL 3.x works too). Overwrites the files.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
if [[ $# -gt 1 ]]; then
  usage >&2
  exit 2
fi

# The output folder: the first argument, or this script's own folder.
OUT_DIR="$(cd "${1:-$(dirname "${BASH_SOURCE[0]}")}" && pwd)"
readonly OUT_DIR
readonly DAYS_20_YEARS=7305

# Chromium does not accept a wildcard directly under an unknown registry such
# as `.test`, so every fixture host is listed by name; `*.test` stays in the
# list for clients (and future hosts) that do accept it.
readonly VALID_HOSTS=(
  '*.test' app.test other.test third.test staging.test auth.test github.test
  react18.test react19.test hostile.test hostile-other.test
  notify.test geo.test camera.test mic.test screen.test clipboard.test
  midi.test usb.test fullscreen.test storage.test site-a.test site-b.test localhost
)

WORK_DIR="$(mktemp -d)"
readonly WORK_DIR
trap 'rm -rf -- "${WORK_DIR}"' EXIT

new_key() {
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$1" 2>/dev/null
}

# san_list host... -> "DNS:a,DNS:b,IP:127.0.0.1"
san_list() {
  local san='' host
  for host in "$@"; do
    san+="DNS:${host},"
  done
  printf '%sIP:127.0.0.1' "${san}"
}

# A minimal `openssl ca` setup: the only portable way to sign a certificate
# with an explicit start and end date (needed for the expired one).
cat >"${WORK_DIR}/ca.cnf" <<EOF
[ ca ]
default_ca = test_ca
[ test_ca ]
dir = ${WORK_DIR}
database = ${WORK_DIR}/index.txt
new_certs_dir = ${WORK_DIR}
serial = ${WORK_DIR}/serial
default_md = sha256
policy = policy_any
copy_extensions = none
unique_subject = no
[ policy_any ]
commonName = supplied
[ req ]
distinguished_name = dn
prompt = no
[ dn ]
CN = placeholder
[ v3_ca ]
basicConstraints = critical, CA:true, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
EOF
: >"${WORK_DIR}/index.txt"
printf '1000\n' >"${WORK_DIR}/serial"

# sign_leaf name cn start end san
sign_leaf() {
  local name="$1" cn="$2" start="$3" end="$4" san="$5"
  new_key "${OUT_DIR}/${name}.key.pem"
  openssl req -new -key "${OUT_DIR}/${name}.key.pem" -subj "/CN=${cn}" -out "${WORK_DIR}/${name}.csr"
  cat >"${WORK_DIR}/${name}.ext" <<EOF
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = ${san}
authorityKeyIdentifier = keyid
subjectKeyIdentifier = hash
EOF
  openssl ca -batch -notext -config "${WORK_DIR}/ca.cnf" \
    -cert "${OUT_DIR}/ca.pem" -keyfile "${OUT_DIR}/ca.key.pem" \
    -startdate "${start}" -enddate "${end}" \
    -extfile "${WORK_DIR}/${name}.ext" \
    -in "${WORK_DIR}/${name}.csr" -out "${OUT_DIR}/${name}.pem" 2>/dev/null
}

# self_signed name cn
self_signed() {
  local name="$1" cn="$2"
  new_key "${OUT_DIR}/${name}.key.pem"
  openssl req -x509 -new -key "${OUT_DIR}/${name}.key.pem" -sha256 -days "${DAYS_20_YEARS}" \
    -subj "/CN=${cn}" \
    -addext "subjectAltName = DNS:${cn}" \
    -addext 'basicConstraints = critical, CA:false' \
    -addext 'extendedKeyUsage = serverAuth' \
    -out "${OUT_DIR}/${name}.pem"
}

# The CA.
new_key "${OUT_DIR}/ca.key.pem"
openssl req -x509 -new -key "${OUT_DIR}/ca.key.pem" -sha256 -days "${DAYS_20_YEARS}" \
  -subj '/CN=Erfana e2e test CA (test only)/O=Qodeca test fixtures' \
  -config "${WORK_DIR}/ca.cnf" -extensions v3_ca \
  -out "${OUT_DIR}/ca.pem"

# Leaves start on 1 January of the current year, so a runner whose clock lags
# never sees a "not yet valid" certificate, and run exactly 20 years.
start_year="$(date -u +%Y)"
start_utc="${start_year}0101000000Z"
end_utc="$(( start_year + 20 ))0101000000Z"

sign_leaf valid 'staging.test' "${start_utc}" "${end_utc}" "$(san_list "${VALID_HOSTS[@]}")"
sign_leaf expired 'expired.test' '20000101000000Z' '20010101000000Z' "$(san_list expired.test)"
sign_leaf mismatch 'not-this-host.example' "${start_utc}" "${end_utc}" 'DNS:not-this-host.example'
self_signed selfsigned selfsigned.test
self_signed selfsigned-b selfsigned.test

printf 'Wrote test certificates to %s\n' "${OUT_DIR}"
