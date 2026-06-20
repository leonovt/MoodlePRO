#!/bin/bash
### MoodlePRO cluster reachability probe.
### Purpose: BEFORE setting anything else up, confirm a compute node can reach the
### Oracle VM's HTTP server and Redis. The whole cluster-worker path depends on this
### outbound connectivity (compute nodes are outbound-only; nothing connects IN).
###
### Submit (pass your real endpoints):
###   sbatch --export=ALL,SERVER_URL='https://your-vm.example.com',REDIS_HOST='your-vm.example.com',REDIS_PORT='6379' probe.sbatch
### Then read the .out file:  cat moodlepro-probe-*.out

#SBATCH --partition main                         ### CPU partition; this probe needs no GPU
#SBATCH --time 0-00:05:00                         ### 5 minutes is plenty
#SBATCH --job-name moodlepro-probe
#SBATCH --output moodlepro-probe-%J.out
#SBATCH --gpus=0

echo "SLURM_JOB_NODELIST=$SLURM_JOB_NODELIST"
echo "host=$(hostname)   date=$(date -u)"
echo

: "${SERVER_URL:?set SERVER_URL via --export}"
: "${REDIS_HOST:?set REDIS_HOST via --export}"
: "${REDIS_PORT:=6379}"

echo "=== 1. Egress IP (give this to the VM firewall allowlist) ==="
curl -fsS --max-time 10 https://api.ipify.org && echo || echo "  (could not determine egress IP)"
echo

echo "=== 2. DNS resolution of the server host ==="
SERVER_HOST=$(echo "$SERVER_URL" | sed -E 's#^[a-z]+://##; s#[:/].*$##')
getent hosts "$SERVER_HOST" || echo "  FAILED to resolve $SERVER_HOST"
echo

echo "=== 3. HTTP GET $SERVER_URL/health ==="
if curl -fsS --max-time 15 "$SERVER_URL/health"; then
    echo; echo "  HTTP OK"
else
    echo "  FAILED to reach $SERVER_URL/health"
fi
echo

echo "=== 4. Raw TCP PING to Redis at $REDIS_HOST:$REDIS_PORT ==="
### Dependency-free check using bash /dev/tcp. A reply of +PONG (or even a
### -NOAUTH/-ERR error) proves the port is reachable and a Redis is listening.
### NOTE: this is a PLAINTEXT check; if your Redis uses TLS (rediss://), it will
### look unreachable here — verify TLS separately with redis-cli --tls.
if (exec 3<>"/dev/tcp/${REDIS_HOST}/${REDIS_PORT}") 2>/dev/null; then
    exec 3<>"/dev/tcp/${REDIS_HOST}/${REDIS_PORT}"
    printf 'PING\r\n' >&3
    if read -t 5 -r reply <&3; then
        echo "  Redis replied: ${reply}"
    else
        echo "  TCP opened but no reply within 5s"
    fi
    exec 3>&- 3<&-
else
    echo "  FAILED to open TCP to ${REDIS_HOST}:${REDIS_PORT}"
fi
echo

echo "=== probe done ==="
