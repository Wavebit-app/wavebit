#!/usr/bin/env bash
# Installs a built wavebit-party binary as a hardened service behind Caddy on
# an Ubuntu 22.04/24.04 VM (Oracle Cloud's Always Free shapes work). Safe to
# re-run: it replaces the binary and restarts.
#
#   sudo DOMAIN=party.example.com BINARY=./wavebit-party SHA256=<hex> bash deploy/setup.sh
#
# Nothing is compiled on the server and no script is fetched and run as root:
# build the binary in CI (or with `go build ./cmd/wavebit-party`), copy it
# here, and pass its SHA-256 so a swapped file is refused. The DNS A record
# for $DOMAIN must already point at this VM, or Caddy can't get a certificate.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

DOMAIN="${DOMAIN:?set DOMAIN, e.g. DOMAIN=party.example.com}"
BINARY="${BINARY:?set BINARY to the built wavebit-party file}"
SHA256="${SHA256:?set SHA256 to the expected sha256 of the binary}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "== check the binary"
echo "$SHA256  $BINARY" | sha256sum -c -

echo "== packages"
if ! dpkg -s curl gnupg iptables-persistent >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y curl debian-keyring debian-archive-keyring apt-transport-https gnupg iptables-persistent
fi

echo "== install"
id wavebit-party >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin wavebit-party
install -d -m 755 /opt/wavebit-party
install -m 755 -o root -g root "$BINARY" /opt/wavebit-party/wavebit-party
umask 077
printf 'JAM_PUBLIC_ORIGIN=https://%s\n' "$DOMAIN" > /etc/wavebit-party.env
umask 022

echo "== service"
install -m 644 "$HERE/wavebit-party.service" /etc/systemd/system/wavebit-party.service
systemctl daemon-reload
systemctl enable wavebit-party
systemctl restart wavebit-party

echo "== caddy (HTTPS + WebSocket proxy)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
sed "s/{\$DOMAIN}/$DOMAIN/" "$HERE/Caddyfile" > "$WORK/Caddyfile"
if ! cmp -s "$WORK/Caddyfile" /etc/caddy/Caddyfile; then
  install -m 644 "$WORK/Caddyfile" /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
fi
# Hard memory cap so a runaway Caddy is killed and restarted alone rather than the
# whole 1 GB VM thrashing swap. No soft GOMEMLIMIT: a limit below the working set
# made the Go GC run flat out on a CPU the hypervisor was already starving.
install -d /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/memory.conf <<'UNIT'
[Service]
MemoryMax=750M
Restart=always
RestartSec=2
UNIT
systemctl daemon-reload

echo "== kernel network limits"
# The micro VM's default conntrack table is tiny (7680) and keeps an idle
# established TCP flow for five days, which is how a crowd of phones that
# vanish without a FIN would fill it. Give it room and a one-hour memory.
cat > /etc/sysctl.d/90-wavebit-party.conf <<'SYSCTL'
net.netfilter.nf_conntrack_max = 65536
net.netfilter.nf_conntrack_tcp_timeout_established = 3600
SYSCTL
# Load the module at boot, or systemd-sysctl runs before it exists and the limit is lost.
echo nf_conntrack > /etc/modules-load.d/nf_conntrack.conf
sysctl --system >/dev/null 2>&1 || true

echo "== swap"
# 1 GB of RAM and no swap meant a connection spike could get Caddy OOM-killed.
if ! swapon --show --noheadings | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness = 1' > /etc/sysctl.d/91-wavebit-party-swap.conf
sysctl -q -p /etc/sysctl.d/91-wavebit-party-swap.conf || true

echo "== tcp buffers + health watchdog"
echo "$DOMAIN" > /etc/wavebit-party-domain
# Smaller default TCP buffers so thousands of idle sockets cost less kernel memory.
cat > /etc/sysctl.d/92-wavebit-party-tcp.conf <<'SYSCTL'
net.ipv4.tcp_rmem = 4096 16384 262144
net.ipv4.tcp_wmem = 4096 16384 262144
SYSCTL
sysctl -q -p /etc/sysctl.d/92-wavebit-party-tcp.conf || true
cat > /usr/local/sbin/wavebit-party-watchdog <<'WATCHDOG'
#!/usr/bin/env bash
# Restarts Caddy when the public health check has failed twice in a row. The 1 GB
# VM can get wedged under a connection surge; this heals it within ~2 minutes
# instead of waiting for a human. At most one restart per 5 minutes.
DOMAIN="$(cat /etc/wavebit-party-domain)"
F=/run/wavebit-party-watchdog.fails; L=/run/wavebit-party-watchdog.last
if curl -sk -m6 -o /dev/null -f --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/healthz"; then echo 0 > $F; exit 0; fi
n=$(( $(cat $F 2>/dev/null || echo 0) + 1 )); echo $n > $F
[ "$n" -lt 2 ] && exit 0
now=$(date +%s); last=$(cat $L 2>/dev/null || echo 0)
[ $((now - last)) -lt 300 ] && exit 0
echo $now > $L; echo 0 > $F
logger -t wavebit-party-watchdog "health check failed twice; restarting caddy"
systemctl restart caddy
WATCHDOG
chmod 755 /usr/local/sbin/wavebit-party-watchdog
cat > /etc/systemd/system/wavebit-party-watchdog.service <<'UNIT'
[Unit]
Description=Restart Caddy if the health check keeps failing
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/wavebit-party-watchdog
UNIT
cat > /etc/systemd/system/wavebit-party-watchdog.timer <<'UNIT'
[Unit]
Description=Run the party server health watchdog every minute
[Timer]
OnBootSec=3min
OnUnitActiveSec=60s
AccuracySec=5s
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now wavebit-party-watchdog.timer >/dev/null 2>&1 || true

echo "== firewall"
# Oracle's Ubuntu images ship an iptables REJECT rule that blocks everything
# but SSH, independent of the VCN security list. Open 80/443 above it.
for port in 80 443; do
  while iptables -D INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null; do :; done
  reject="$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')"
  iptables -I INPUT "${reject:-1}" -p tcp --dport "$port" -m state --state NEW -j ACCEPT
done
netfilter-persistent save

echo "== check"
sleep 2
curl -fsS http://127.0.0.1:8000/healthz && echo
echo "Done. Once DNS resolves, https://$DOMAIN/healthz should answer."
