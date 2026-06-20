#!/bin/bash
### MoodlePRO persistent GPU transcription worker for the BGU SLURM cluster.
### Runs the existing gpu_worker/worker.py with a real faster-whisper model, holding
### one GPU for up to 7 days. It is outbound-only: it pops jobs from the Oracle VM's
### Redis and reports results to the VM's HTTP API. Your laptop is NOT needed once
### this is submitted — only to set up the conda env and (re)submit the job.
###
### One-time setup and submission instructions: see cluster/README.md
### Submit:   sbatch worker.sbatch
### Re-submit so a fresh job auto-starts when this one ends (preemption/7-day limit):
###   sbatch --dependency=singleton worker.sbatch     # relies on the shared --job-name

#SBATCH --partition main                          ### 'main' unless you have QoS rights; GPU type is chosen via --gpus
#SBATCH --time 7-00:00:00                          ### 7 days = the partition max
#SBATCH --job-name moodlepro-worker                ### shared name enables --dependency=singleton chaining (do not change)
#SBATCH --output moodlepro-worker-%J.out
#SBATCH --gpus=rtx_3090:1                          ### 24G; turbo model fits easily. Alternatives: rtx_2080:1 / rtx_4090:1 / rtx_6000:1
#SBATCH --mail-user=prives@post.bgu.ac.il          ### CHANGE if needed
#SBATCH --mail-type=BEGIN,END,FAIL

echo "SLURM_JOBID=$SLURM_JOBID"
echo "SLURM_JOB_NODELIST=$SLURM_JOB_NODELIST"

### --- Configuration -------------------------------------------------------------
### REPO_DIR: where this repo lives on the cluster (home is on shared storage, so all
### nodes see it). Override with: sbatch --export=ALL,REPO_DIR=/storage/me/MoodlePRO worker.sbatch
REPO_DIR="${REPO_DIR:-$HOME/MoodlePRO}"
CONDA_ENV="${CONDA_ENV:-moodlepro}"

### Secrets (REDIS_URL, SERVER_BASE_URL, INTERNAL_API_TOKEN) live OUTSIDE the repo so
### they are never committed. Create ~/.moodlepro.env (chmod 600) — see cluster/README.md.
SECRETS_FILE="${SECRETS_FILE:-$HOME/.moodlepro.env}"
if [ -f "$SECRETS_FILE" ]; then
    set -a; source "$SECRETS_FILE"; set +a
else
    echo "ERROR: secrets file $SECRETS_FILE not found (needs REDIS_URL, SERVER_BASE_URL, INTERNAL_API_TOKEN)" >&2
    exit 1
fi

### Non-secret worker config. pydantic-settings reads these from the environment
### (UPPER_SNAKE maps to the WorkerSettings fields), so no .env file is required here.
export FAKE_TRANSCRIBE=false
export MODEL_NAME="${MODEL_NAME:-ivrit-ai/whisper-large-v3-turbo-ct2}"
export DEVICE=cuda
export COMPUTE_TYPE="${COMPUTE_TYPE:-float16}"
export LANGUAGE="${LANGUAGE:-he}"
export HEARTBEAT_INTERVAL_SECONDS="${HEARTBEAT_INTERVAL_SECONDS:-10}"
export HEARTBEAT_TTL_SECONDS="${HEARTBEAT_TTL_SECONDS:-30}"
### Cache the HF model download under home (shared storage) so nodes don't re-download.
export HF_HOME="${HF_HOME:-$HOME/.cache/huggingface}"
export PYTHONUNBUFFERED=TRUE                        ### live, unbuffered logs in the .out file

### --- Environment ---------------------------------------------------------------
module load anaconda
source activate "$CONDA_ENV"

echo "=== GPU allocated ==="
nvidia-smi -L

### --- Run ------------------------------------------------------------------------
cd "$REPO_DIR/gpu_worker" || { echo "ERROR: $REPO_DIR/gpu_worker not found" >&2; exit 1; }
echo "starting worker (model=$MODEL_NAME, server=$SERVER_BASE_URL)"
python -u worker.py
