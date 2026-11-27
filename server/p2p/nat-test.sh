#!/usr/bin/env bash
# Two homes behind NAT routers and a relay on a pretend internet, inside one
# user namespace (no root needed), to see Host on this device get a direct
# connection, or fall back to the relay.
#
#   go build -o <dir>/wavebit-p2p ./cmd/wavebit-p2p
#   go build -o <dir>/wavebit-relay ./cmd/wavebit-relay
#   unshare -rnm bash p2p/nat-test.sh <dir> cone|symmetric
#
#   cone       ordinary home routers: the port is kept, so hole punching works
#   symmetric  random ports: hole punching fails and the relay carries the party
#
# With EXPECT=direct or EXPECT=relayed it exits 1 unless the party ended up
# that way and still answered (for CI).
#
# Both routers drop unsolicited traffic from outside, as home routers do.
# Needs the kernel's iptables MASQUERADE and conntrack modules loaded.
set -euo pipefail
trap 'kill $(jobs -p) 2>/dev/null || true' EXIT
DIR=$1
KIND=${2:-cone}
cd "$DIR"
mount -t tmpfs tmpfs /run
mkdir -p /run/netns
for n in inet relay rA rB hA hB; do ip netns add $n; done
x() { ip netns exec "$@"; }

# The internet: a bridge in inet, with the relay and both routers' WAN sides on it.
x inet ip link add br0 type bridge
x inet ip link set br0 up
x inet ip link set lo up
for pair in "relay:eth0:5.5.5.1" "rA:wan:5.5.5.10" "rB:wan:5.5.5.20"; do
  IFS=: read -r ns dev addr <<<"$pair"
  ip link add "$dev" netns "$ns" type veth peer name "to-$ns" netns inet
  x inet ip link set "to-$ns" master br0
  x inet ip link set "to-$ns" up
  x "$ns" ip addr add "$addr/24" dev "$dev"
  x "$ns" ip link set "$dev" up
  x "$ns" ip link set lo up
done

# Each home: a router with a LAN side, and a computer on it.
home() {
  local r=$1 h=$2 lan=$3
  ip link add lan netns "$r" type veth peer name eth0 netns "$h"
  x "$r" ip addr add "$lan.1/24" dev lan
  x "$r" ip link set lan up
  x "$h" ip addr add "$lan.2/24" dev eth0
  x "$h" ip link set eth0 up
  x "$h" ip link set lo up
  x "$h" ip route add default via "$lan.1"
  x "$r" sysctl -qw net.ipv4.ip_forward=1
  local flags=""
  [ "$KIND" = symmetric ] && flags="--random-fully"
  x "$r" iptables -t nat -A POSTROUTING -o wan -j MASQUERADE $flags
  x "$r" iptables -P FORWARD DROP
  x "$r" iptables -A FORWARD -i lan -j ACCEPT
  x "$r" iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  # Like a home router: nothing unsolicited reaches the router itself from outside.
  x "$r" iptables -A INPUT -i wan -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  x "$r" iptables -A INPUT -i wan -j DROP
}
home rA hA 10.0.1
home rB hB 10.0.2

# The relay.
# Started without the x helper, so the exit trap can reach it.
ip netns exec relay env WAVEBIT_RELAY_KEY_FILE="$DIR/relay.key" \
  WAVEBIT_RELAY_LISTEN=/ip4/5.5.5.1/tcp/4001,/ip4/5.5.5.1/udp/4001/quic-v1 \
  ./wavebit-relay >relay.log 2>&1 &
for i in $(seq 1 50); do grep -q "/p2p/" relay.log && break; sleep 0.1; done
RELAY=$(grep -o '/ip4/5.5.5.1/udp/4001/quic-v1/p2p/[A-Za-z0-9]*' relay.log | head -1)
echo "relay $RELAY"

# Reachability checks: a home can reach the relay, not the other home.
x hA ping -c1 -W1 5.5.5.1 >/dev/null && echo "hA reaches the relay"
x hA ping -c1 -W1 10.0.2.2 >/dev/null 2>&1 && echo "PROBLEM: hA reaches hB directly" || echo "hA can't reach hB's LAN (as at home)"

BK=bridge-key-0123456789abcdefghij
PK=party-key-0123456789abcdefgh

# The host's helper in home A.
mkfifo host.in
ip netns exec hA env GOLOG_LOG_LEVEL=holepunch=debug,observedaddrs=debug,basichost=debug,autonatv2=debug,p2p-holepunch=debug ./wavebit-p2p <host.in >host.out 2>host.err &
exec 7>host.in
echo "{\"mode\":\"host\",\"bridgeKey\":\"$BK\",\"partyKey\":\"$PK\",\"relay\":\"$RELAY\",\"direct\":true}" >&7
for i in $(seq 1 100); do grep -q ready host.out && break; sleep 0.2; done
cat host.out
HPORT=$(grep -o '"port":[0-9]*' host.out | head -1 | cut -d: -f2)
HPEER=$(grep -o '"peerId":"[^"]*"' host.out | head -1 | head -1 | cut -d'"' -f4)
CODE=$(x hA curl -s -H "X-Wavebit-Bridge: $BK" -H 'Content-Type: application/json' \
  -d '{"userId":"u1","deviceId":"d1","displayName":"Asha"}' "http://127.0.0.1:$HPORT/api/parties" | grep -o '"code":"[A-Z0-9]*"' | head -1 | cut -d'"' -f4)
echo "party $CODE on home A"

set +e
# The friend's helper in home B.
mkfifo guest.in
ip netns exec hB env GOLOG_LOG_LEVEL=holepunch=debug,observedaddrs=debug,basichost=debug,p2p-holepunch=debug ./wavebit-p2p <guest.in >guest.out 2>guest.err &
exec 8>guest.in
echo "{\"mode\":\"join\",\"bridgeKey\":\"$BK\",\"partyKey\":\"$PK\",\"hostPeer\":\"$HPEER\",\"relay\":\"$RELAY\",\"direct\":true}" >&8
for i in $(seq 1 150); do grep -q ready guest.out && break; sleep 0.2; done
GPORT=$(grep -o '"port":[0-9]*' guest.out | head -1 | cut -d: -f2)
echo "guest ready after ${i} polls on port $GPORT: $(head -1 guest.out)"
start=$(date +%s%N)
x hB curl -s -o /dev/null -w "join through the relay: %{http_code} in %{time_total}s\n" -H "X-Wavebit-Bridge: $BK" -H 'Content-Type: application/json' \
  -d '{"userId":"u2","deviceId":"d2","displayName":"Maya"}' "http://127.0.0.1:$GPORT/api/parties/$CODE/join"

# Wait for hole punching.
for i in $(seq 1 30); do
  grep -q '"direct":1' guest.out && grep -q '"direct":1' host.out && break
  sleep 1
done
echo "after ${i}s:"
echo "  host:  $(tail -1 host.out)"
echo "  guest: $(tail -1 guest.out)"
x hB curl -s -o /dev/null -w "a request after: %{http_code} in %{time_total}s\n" -H "X-Wavebit-Bridge: $BK" "http://127.0.0.1:$GPORT/api/time"
echo "conntrack on router A (direct flows to home B's public address 5.5.5.20):"
x rA nft list ruleset >/dev/null
x rA cat /proc/net/nf_conntrack 2>/dev/null | grep -c "dst=5.5.5.20" || echo "  (conntrack table not readable here)"
LAST_HOST=$(grep '"links"' host.out | tail -1)
LAST_GUEST=$(grep '"links"' guest.out | tail -1)
ANSWER=$(x hB curl -s -o /dev/null -w "%{http_code}" -H "X-Wavebit-Bridge: $BK" "http://127.0.0.1:$GPORT/api/time")
exec 7>&- 8>&-
sleep 1
if [ -n "${EXPECT:-}" ]; then
  case "$EXPECT" in
    direct) want='"direct":1,"event":"links","relayed":0' ;;
    relayed) want='"direct":0,"event":"links","relayed":1' ;;
    *) echo "EXPECT is direct or relayed"; exit 2 ;;
  esac
  if [[ "$LAST_HOST" == *"$want"* && "$LAST_GUEST" == *"$want"* && "$ANSWER" == 200 ]]; then
    echo "PASS: $EXPECT"
  else
    echo "FAIL: wanted $EXPECT; host $LAST_HOST; guest $LAST_GUEST; answer $ANSWER"
    exit 1
  fi
fi
