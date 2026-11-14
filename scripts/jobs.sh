#!/bin/sh
# The scheduled jobs, run by the "jobs" container: timesheet reminders every 15 minutes, expired
# stories every hour and public holidays once a day. Each run is safe to repeat, and one failing
# never stops the others.
set -u

run() {
  python manage.py "$@" || echo "Scheduled job failed: $1" >&2
}

tick=0
while :; do
  run timesheet_reminders --quiet
  [ $((tick % 4)) -eq 0 ] && run expire_stories
  [ $((tick % 96)) -eq 0 ] && run sync_holidays
  tick=$((tick + 1))
  sleep 900
done
