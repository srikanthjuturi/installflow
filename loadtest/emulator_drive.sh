#!/usr/bin/env bash
# Drive the real technician app on an Android emulator while Locust runs.
#
#   bash emulator_drive.sh <serial> <run-id> <minutes>
#
# Taps Home -> job pool -> back -> Jobs -> Earnings -> Profile in a loop and
# records, per screen, how long until that screen's own text was on screen.
# The time is coarse: it includes a `uiautomator dump` (~1-2 s on this laptop),
# so it answers "did the screen come up, and roughly when", not milliseconds.
# Coordinates are for a 720x1600 display (`adb shell wm size 720x1600`).
#
# Writes results/<run>-emulator.csv and a screenshot per round.
set -u
D="$1"; RUN="$2"; MINUTES="$3"
ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/results/$RUN-emulator.csv"
SHOTS="$HERE/results/$RUN-emulator"
mkdir -p "$SHOTS"
echo "utc,round,screen,seconds,result" > "$OUT"

texts() { "$ADB" -s "$D" shell "uiautomator dump /sdcard/u.xml >/dev/null 2>&1; cat /sdcard/u.xml" 2>/dev/null; }

# visit <name> <marker regex> <tap command...>
visit() {
  local name="$1" marker="$2"; shift 2
  local start end xml result="timeout"
  start=$(date +%s.%N)
  "$@"
  for _ in $(seq 1 15); do
    xml=$(texts)
    if echo "$xml" | grep -q "Not Responding"; then result="anr"; break; fi
    if echo "$xml" | grep -Eqi "$marker"; then result="ok"; break; fi
    sleep 0.5
  done
  end=$(date +%s.%N)
  printf '%s,%s,%s,%.1f,%s\n' "$(date -u +%H:%M:%S)" "$round" "$name" "$(awk "BEGIN{print $end - $start}")" "$result" >> "$OUT"
}

tap() { "$ADB" -s "$D" shell input tap "$1" "$2"; }
back() { "$ADB" -s "$D" shell input keyevent 4; }

deadline=$(( $(date +%s) + ${MINUTES%.*} * 60 ))
round=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  round=$((round + 1))
  visit home "Today's jobs" tap 90 1567
  visit pool "job pool|jobs? in (the )?pool|accept" tap 360 500
  back; sleep 1
  visit jobs 'text="My jobs"' tap 269 1567
  visit earnings 'Net payout after penalties' tap 450 1567
  visit profile 'SERVICE COVERAGE' tap 630 1567
  "$ADB" -s "$D" exec-out screencap -p > "$SHOTS/round$(printf %02d $round).png"
  sleep 3
done
echo "emulator done"
