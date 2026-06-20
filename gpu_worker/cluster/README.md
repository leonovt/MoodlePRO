# Running the MoodlePRO GPU worker on the BGU SLURM cluster

The cluster (`slurm.bgu.ac.il`) is the **primary** GPU for transcription; Groq is the
cloud fallback the server uses whenever no worker heartbeat is present. The worker is
outbound-only — it pops jobs from the Oracle VM's Redis and reports results to the VM's
HTTP API — so it runs fine behind the cluster's NAT and needs neither your laptop nor a
VPN once submitted. (VPN is only needed for *you* to SSH in from off-campus.)

This folder has two batch files:

| File | What it does | When |
| --- | --- | --- |
| `probe.sbatch` | 5-min CPU job that checks a compute node can reach the VM's `/health` and Redis | **First**, before anything else |
| `worker.sbatch` | 7-day GPU job running `worker.py` with the real model | After the probe passes and the env is set up |

## Step 0 — Run the probe first (de-risk connectivity)

Everything below depends on a compute node being able to reach your VM. Confirm it in 5
minutes before investing in env setup:

```bash
ssh <bgu-user>@slurm.bgu.ac.il
cd ~/MoodlePRO/gpu_worker/cluster
sbatch --export=ALL,SERVER_URL='https://YOUR-VM',REDIS_HOST='YOUR-VM',REDIS_PORT='6379' probe.sbatch
# wait for it to run, then:
cat moodlepro-probe-*.out
```

You want section 3 to print `HTTP OK` and section 4 to show a Redis reply (`+PONG`, or
even a `-NOAUTH`/`-ERR` line — any reply proves reachability). Section 1 prints the
cluster's **egress IP**; add it to the VM firewall allowlist for the Redis port. If the
probe can't reach the VM, fix that (firewall / security group / TLS) before continuing.

## Step 1 — One-time environment setup (on the manager node)

```bash
ssh <bgu-user>@slurm.bgu.ac.il
# Get the code onto shared storage (home is shared across all nodes):
git clone <your-repo-url> ~/MoodlePRO        # or update an existing checkout

module load anaconda
conda create -y -n moodlepro python=3.11
source activate moodlepro

cd ~/MoodlePRO/gpu_worker
# Enable the real model: uncomment faster-whisper in requirements.txt, then:
pip install -r requirements.txt
conda deactivate                              # the guide: submit jobs with the env DEACTIVATED
```

> The model `ivrit-ai/whisper-large-v3-turbo-ct2` downloads from Hugging Face on first
> run into `$HF_HOME` (defaults to `~/.cache/huggingface`, which is on shared storage, so
> it downloads once and every node reuses it).

## Step 2 — Create the secrets file (never committed)

`worker.sbatch` sources `~/.moodlepro.env` for the values that must stay out of git:

```bash
cat > ~/.moodlepro.env <<'EOF'
REDIS_URL=redis://YOUR-VM:6379/0
SERVER_BASE_URL=https://YOUR-VM
INTERNAL_API_TOKEN=<the same long secret the server uses>
EOF
chmod 600 ~/.moodlepro.env
```

`INTERNAL_API_TOKEN` must match the server's. Use TLS endpoints (`rediss://`, `https://`)
if the VM exposes them.

## Step 3 — Submit the worker

```bash
cd ~/MoodlePRO/gpu_worker/cluster
sbatch worker.sbatch
squeue --me                                   # watch it go PENDING -> RUNNING
tail -f moodlepro-worker-*.out                # 'GPU allocated' + 'starting worker'
```

Once it's RUNNING, the server sees the heartbeat (`worker:heartbeat` in Redis) and routes
cache-miss jobs to the cluster instead of Groq.

## Step 4 — Keep it alive across the 7-day limit / preemption (Phase 5)

A job ends after 7 days, or sooner if preempted / the node is taken for maintenance. To
auto-start a fresh one when the current job ends, submit a chained job that waits on the
shared `--job-name`:

```bash
sbatch --dependency=singleton worker.sbatch
```

`singleton` means "start after any job with the same name+user finishes." You can keep one
of these queued at all times so there's always a successor. During any gap (no live
heartbeat), the server falls back to Groq automatically, so transcription never stops.

## Tips

- **GPU choice:** `worker.sbatch` requests `rtx_3090:1` (24G). The turbo model also fits a
  `rtx_2080` (11G). Avoid the 1080s — Pascal is poor for float16 CT2. Change `--gpus` to
  pick another card, or add `#SBATCH --constraint=...` / `#SBATCH --exclude=...`.
- **Be a good cluster citizen:** holding a GPU for 7 days is heavy on a shared cluster. If
  admins object, run the worker only when you're actively transcribing and let Groq cover
  the rest — the routing already handles either mode with no code change.
- **Stopping:** `scancel <jobid>` (or `scancel --name moodlepro-worker`). The heartbeat
  expires within `HEARTBEAT_TTL_SECONDS` and the server reverts to Groq.
