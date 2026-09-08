#!/usr/bin/env bash
# Slowly move the TCP along one URDF base_link axis to verify its physical direction.
# Usage: ./scripts/verify_cartesian_axis.sh <x|y|z> <+|-> [distance_mm]

set -euo pipefail

API_BASE="${ROBOT_API_BASE:-http://localhost:8081/api}"
AXIS="${1:-}"
DIRECTION="${2:-}"
TOTAL_MM="${3:-150}"
STEP_MM="${STEP_MM:-1}"
PAUSE_S="${PAUSE_S:-0.25}"
POLL_S="${POLL_S:-0.1}"
MOTION_TIMEOUT_S="${MOTION_TIMEOUT_S:-1000}"

usage() {
    printf 'Usage: %s <x|y|z> <+|-> [distance_mm]\n' "$0"
    printf 'Example: %s x + 150\n' "$0"
    printf 'Environment: ROBOT_API_BASE, STEP_MM, PAUSE_S, POLL_S, MOTION_TIMEOUT_S\n'
}

is_positive_number() {
    python3 - "$1" <<'PY'
import math
import sys
try:
    value = float(sys.argv[1])
except ValueError:
    raise SystemExit(1)
raise SystemExit(0 if math.isfinite(value) and value > 0 else 1)
PY
}

if [[ ! "$AXIS" =~ ^[xyz]$ ]] || [[ ! "$DIRECTION" =~ ^[+-]$ ]]; then
    usage
    exit 2
fi
if ! is_positive_number "$TOTAL_MM" || ! is_positive_number "$STEP_MM"; then
    printf 'distance_mm and STEP_MM must be positive numbers.\n' >&2
    exit 2
fi

TOTAL_MM="$(python3 - "$TOTAL_MM" <<'PY'
import sys
print(float(sys.argv[1]))
PY
)"
STEP_MM="$(python3 - "$STEP_MM" "$TOTAL_MM" <<'PY'
import sys
print(min(float(sys.argv[1]), float(sys.argv[2]), 20.0))
PY
)"

health="$(curl --silent --show-error --fail --max-time 3 "$API_BASE/health")" || {
    printf 'Cannot reach Robot Controller at %s\n' "$API_BASE" >&2
    exit 1
}
connected="$(python3 -c 'import json,sys; print(str(bool(json.load(sys.stdin).get("robot_connected"))).lower())' <<<"$health")"
if [[ "$connected" != "true" ]]; then
    printf 'Robot Controller is reachable, but the robot is not connected.\n' >&2
    exit 1
fi

printf '\nURDF base_link axis verification\n'
printf '  Axis:       %s%s\n' "$DIRECTION" "${AXIS^^}"
printf '  Distance:   %.1f mm (15 cm by default)\n' "$TOTAL_MM"
printf '  Step:       %.1f mm\n' "$STEP_MM"
printf '  Pause:      %.2f s after each completed step\n' "$PAUSE_S"
printf '  API:        %s\n\n' "$API_BASE"
printf 'Stop Coach/VR control and clear at least 20 cm around the arm.\n'
printf 'Ctrl+C will cancel motion and DISABLE MOTOR TORQUE.\n\n'

moving=false
emergency_stop() {
    trap - INT TERM
    printf '\nStopping motion and disabling motor torque...\n' >&2
    curl --silent --show-error --max-time 3 --request POST "$API_BASE/emergency_stop" >/dev/null || true
    exit 130
}
trap emergency_stop INT TERM

moved_mm=0.0
while python3 - "$moved_mm" "$TOTAL_MM" <<'PY'
import sys
raise SystemExit(0 if float(sys.argv[1]) < float(sys.argv[2]) - 1e-9 else 1)
PY
do
    increment="$(python3 - "$moved_mm" "$TOTAL_MM" "$STEP_MM" "$DIRECTION" <<'PY'
import sys
moved, total, step = map(float, sys.argv[1:4])
value = min(step, total - moved)
if sys.argv[4] == "-":
    value = -value
print(value)
PY
)"

    response_file="$(mktemp)"
    http_code="$(curl --silent --show-error --max-time 5 \
        --output "$response_file" --write-out '%{http_code}' \
        --request POST "$API_BASE/jog/cartesian" \
        --header 'Content-Type: application/json' \
        --data "{\"axis\":\"$AXIS\",\"delta\":$increment}")" || {
        rm -f "$response_file"
        printf '\nCartesian Jog request failed. No further movement requested.\n' >&2
        exit 1
    }
    response="$(<"$response_file")"
    rm -f "$response_file"

    if [[ ! "$http_code" =~ ^2 ]]; then
        printf '\nJog rejected (HTTP %s): %s\n' "$http_code" "$response" >&2
        printf 'No further movement requested.\n' >&2
        exit 1
    fi

    target="$(python3 -c 'import json,sys; d=json.load(sys.stdin); print("[" + ", ".join(f"{v:.3f}" for v in d.get("target_position_m", [])) + "]")' <<<"$response")"
    moving=true
    start_s="$(date +%s)"
    while [[ "$moving" == "true" ]]; do
        status="$(curl --silent --show-error --fail --max-time 3 "$API_BASE/jog/status")" || {
            printf '\nLost connection while waiting for Jog completion.\n' >&2
            emergency_stop
        }
        moving="$(python3 -c 'import json,sys; print(str(bool(json.load(sys.stdin).get("moving"))).lower())' <<<"$status")"
        if (( $(date +%s) - start_s >= MOTION_TIMEOUT_S )); then
            printf '\nJog did not complete within %ss.\n' "$MOTION_TIMEOUT_S" >&2
            emergency_stop
        fi
        [[ "$moving" == "false" ]] || sleep "$POLL_S"
    done

    result_status="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("status", "unknown"))' <<<"$status")"
    if [[ "$result_status" != "reached" && "$result_status" != "idle" ]]; then
        printf '\nJog ended with status %s; stopping the axis test.\n' "$result_status" >&2
        exit 1
    fi

    moved_mm="$(python3 - "$moved_mm" "$increment" <<'PY'
import sys
print(float(sys.argv[1]) + abs(float(sys.argv[2])))
PY
)"
    printf '\r%s%s: %6.1f / %6.1f mm  target=%s' "$DIRECTION" "${AXIS^^}" "$moved_mm" "$TOTAL_MM" "$target"
    sleep "$PAUSE_S"
done

trap - INT TERM
printf '\nCompleted. The TCP was commanded %.1f mm along URDF base_link %s%s.\n' "$TOTAL_MM" "$DIRECTION" "${AXIS^^}"
printf 'Run the opposite direction to return, for example: %s %s %s %.1f\n' "$0" "$AXIS" "$([[ "$DIRECTION" == "+" ]] && printf -- "-" || printf -- "+")" "$TOTAL_MM"
