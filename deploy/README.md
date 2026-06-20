# MoodlePRO server deployment (Oracle Cloud Always-Free)

This is the always-on home for the **server + Redis + Postgres** — the piece the cluster
GPU worker and the browser extension both connect to. It must live off your laptop so the
laptop is only needed to submit/update the cluster job. The stack runs as four containers
(Postgres, Redis, FastAPI server, Caddy HTTPS proxy) via `docker compose`.

```
            Internet
   ┌───────────┬──────────────┐
   │ :443 (TLS)│ :6379 (Redis) │
   ▼           │              ▼
 Caddy ──► server ──► postgres │
              └────► redis ◄───┘   ◄── cluster GPU worker (outbound only)
```

Caddy terminates HTTPS (auto Let's Encrypt) for the extension + the worker's HTTP calls;
Redis is the one other internet-facing port, locked to the cluster's egress IP.

---

## 1. Provision the VM

In the Oracle Cloud console → **Compute → Instances → Create**:

- **Shape:** `VM.Standard.A1.Flex` (Ampere/ARM, Always-Free). 1–2 OCPU and 6–12 GB RAM is
  plenty. (Our images are multi-arch, so ARM is fine.)
- **Image:** Canonical **Ubuntu 22.04**.
- **Networking:** assign a **public IPv4**. Then **reserve** it (Networking → reserved
  public IPs) so it survives a stop/start — otherwise DNS breaks when the IP changes.
- Add your SSH public key.

## 2. Open ports in the VCN security list

Networking → your VCN → Security List → **Ingress rules**, add:

| Port | Source | Why |
| --- | --- | --- |
| 80  | `0.0.0.0/0` | Let's Encrypt HTTP challenge |
| 443 | `0.0.0.0/0` | HTTPS (extension + worker API) |
| 6379 | *(add in step 7)* | Redis — locked to the cluster egress IP only |

Leave 6379 closed for now; you'll open it to a single IP once the cluster probe reveals it.

## 3. DNS

The extension and the cluster worker need a stable name (Let's Encrypt won't issue for a
bare IP). Free option: **DuckDNS** — create a subdomain, point it at the reserved public
IP. Put that name in `.env` as `DOMAIN` / `PUBLIC_BASE_URL`.

## 4. Install Docker + open the host firewall

The default OCI user is `ubuntu` on Ubuntu images and `opc` on Oracle Linux images.
Pick the matching block below. Either way, **both** the VCN security list (step 2) **and**
the host firewall must allow the port, or you'll get "connection refused" despite correct
VCN rules.

### Ubuntu

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

### Oracle Linux (8/9)

The `get.docker.com` convenience script rejects Oracle Linux (`ERROR: Unsupported
distribution 'ol'`). Install Docker CE from Docker's CentOS repo instead, and use
`firewalld` (active by default on OL) rather than raw iptables:

```bash
sudo dnf install -y dnf-utils
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER && newgrp docker

# firewalld is active on OL images; netfilter-persistent does NOT exist here.
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --reload
```

## 5. Deploy

```bash
# Everything lives on `main`. Repo is private — when prompted for a password, paste a
# GitHub Personal Access Token (Settings → Developer settings → PAT).
git clone https://github.com/RoiPrives/MoodlePRO.git ~/MoodlePRO && cd ~/MoodlePRO/deploy
cp .env.example .env
# Generate secrets and edit .env:
openssl rand -hex 32        # use for POSTGRES_PASSWORD, REDIS_PASSWORD, INTERNAL_API_TOKEN
nano .env                   # set DOMAIN, PUBLIC_BASE_URL, the 3 secrets, and a fresh GROQ_API_KEY

docker compose up -d --build
docker compose ps           # all healthy?
docker compose logs -f caddy   # watch the cert get issued
```

## 6. Verify

```bash
curl https://YOUR-DOMAIN/health      # -> {"status":"ok"}
```

Then from the **cluster** (over VPN), run the connectivity probe — this is the gate for the
whole worker path:

```bash
# on slurm.bgu.ac.il, in gpu_worker/cluster/
sbatch --export=ALL,SERVER_URL='https://YOUR-DOMAIN',REDIS_HOST='YOUR-DOMAIN',REDIS_PORT='6379' probe.sbatch
cat moodlepro-probe-*.out
```

Note the **egress IP** the probe prints in section 1.

## 7. Lock down Redis to the cluster

Now that you know the cluster's egress IP:

1. VCN security list → add **Ingress 6379 from `<cluster-egress-IP>/32`**.
2. On the host, restrict it there too:

   **Ubuntu (iptables):**
   ```bash
   sudo iptables -I INPUT 6 -p tcp -s <cluster-egress-IP> --dport 6379 -j ACCEPT
   sudo iptables -I INPUT 7 -p tcp --dport 6379 -j DROP
   sudo netfilter-persistent save
   ```

   **Oracle Linux (firewalld):** allow 6379 only from the cluster IP via a rich rule —
   don't open the port globally:
   ```bash
   sudo firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address=<cluster-egress-IP>/32 port port=6379 protocol=tcp accept"
   sudo firewall-cmd --reload
   ```

Re-run the probe to confirm Redis is still reachable from the cluster (and ideally that it
is *not* from anywhere else).

---

## Security notes

- **Redis traffic is plaintext** over the internet; we rely on a strong `requirepass` **plus**
  the single-IP allowlist. Acceptable for this project; the hardening step is to tunnel Redis
  over WireGuard/stunnel (TLS) instead of exposing 6379. Revisit before any public launch.
- `INTERNAL_API_TOKEN` here **must equal** the cluster worker's `~/.moodlepro.env` value.
- `.env` is gitignored — keep it that way. Rotate the Groq key that was shared in chat.
- Postgres has **no published port** — it's only reachable from the server container.

## Connecting the worker

On the cluster, `~/.moodlepro.env` (see `gpu_worker/cluster/README.md`) points back here:

```
REDIS_URL=redis://:<REDIS_PASSWORD>@YOUR-DOMAIN:6379/0
SERVER_BASE_URL=https://YOUR-DOMAIN
INTERNAL_API_TOKEN=<same as deploy/.env>
```
