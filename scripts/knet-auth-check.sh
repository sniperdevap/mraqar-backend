#!/bin/bash
# Does this server reach CBK, and which Authorization header does CBK want?
#
# The manual contradicts itself on page 4: the prose says the header is base64-encoded,
# the example right below it shows it unencoded. Variant A is what knet.service.ts sends.
# If B returns HTTP 200, authHeader() is wrong. If both return 401 with no
# WWW-Authenticate header, this server's IP is not on CBK's whitelist.
#
#   bash scripts/knet-auth-check.sh [/path/to/aqar-backend]
#
# Output is scrubbed of the secret and the ENCRP key, so it is safe to paste.
cd "${1:-$(dirname "$0")/..}" || exit 1
[ -f .env ] || { echo "no .env in $(pwd)"; exit 1; }
# Read only what we need. Sourcing the whole .env makes this script hostage to every
# other line in it - an unquoted password with spaces used to abort the run.
kv() { grep -m1 -E "^$1=" .env | sed -E "s/^$1=//; s/^\"(.*)\"$/\\1/; s/^'(.*)'$/\\1/"; }
KNET_BASE_URL=$(kv KNET_BASE_URL)
KNET_CLIENT_ID=$(kv KNET_CLIENT_ID)
KNET_CLIENT_SECRET=$(kv KNET_CLIENT_SECRET)
KNET_ENCRP_KEY=$(kv KNET_ENCRP_KEY)
for v in "$KNET_BASE_URL" "$KNET_CLIENT_ID" "$KNET_CLIENT_SECRET" "$KNET_ENCRP_KEY"; do
  [ -n "$v" ] || { echo "missing a KNET_* var in $(pwd)/.env"; exit 1; }
done

echo "repo=$(pwd)"
echo "base=$KNET_BASE_URL id_len=${#KNET_CLIENT_ID} secret_len=${#KNET_CLIENT_SECRET} key_len=${#KNET_ENCRP_KEY}"
echo "egress_ip=$(curl -s --max-time 10 ifconfig.me)   <- this is what CBK must whitelist"
HOST=$(echo "$KNET_BASE_URL" | sed -E 's#^https?://##; s#/.*##')
echo "dns=$(dig +short "$HOST" 2>/dev/null | tr '\n' ' ')"

# Fail in seconds rather than hanging on two 25s curl timeouts. A machine that cannot open
# port 443 to CBK tells you nothing about the header format - run this on the server.
if ! curl -s -o /dev/null --connect-timeout 8 "https://$HOST" 2>/dev/null; then
  if ! nc -z -G 8 "$HOST" 443 >/dev/null 2>&1; then
    echo
    echo "STOP: this machine cannot open port 443 to $HOST."
    echo "      Nothing was sent. Both header variants would just time out."
    echo "      CBK filters by IP, so run this on the server whose IP CBK knows:"
    echo "        scp scripts/knet-auth-check.sh user@server:/var/www/<app>/scripts/"
    echo "        ssh user@server 'cd /var/www/<app> && npm run test:knet:auth'"
    exit 2
  fi
fi
echo "reachable: TCP 443 to $HOST is open"

URL="$KNET_BASE_URL/ePay/api/cbk/online/pg/merchant/Authenticate"
BODY=$(printf '{"ClientId":"%s","ClientSecret":"%s","ENCRP_KEY":"%s"}' "$KNET_CLIENT_ID" "$KNET_CLIENT_SECRET" "$KNET_ENCRP_KEY")
B64=$(printf '%s:%s' "$KNET_CLIENT_ID" "$KNET_CLIENT_SECRET" | base64 | tr -d '\n')

run() {
  echo; echo "===== VARIANT $1 ====="
  printf '%s' "$BODY" | curl -sS -D /dev/stderr -o /dev/stdout --max-time 25 \
    -X POST "$URL" -H 'Content-Type: application/json' \
    -H "Authorization: Basic $2" --data @- 2>&1 \
    | sed -e "s/$KNET_CLIENT_SECRET/<SECRET>/g" -e "s/$KNET_ENCRP_KEY/<ENCRP>/g" -e "s/$B64/<B64>/g"
  echo; echo "[end $1]"
}

run "A (base64 - what knet.service.ts sends today)" "$B64"
run "B (literal - what the manual's example shows)" "$KNET_CLIENT_ID:$KNET_CLIENT_SECRET"
