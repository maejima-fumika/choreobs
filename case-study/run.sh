#!/bin/sh
# Runs one step of a case study: makes the BlueScript workspace if it is not
# there yet, with `choreobs add-endpoint` for each endpoint in choreobs.json,
# and then runs every endpoint with `choreobs run`. Extra arguments, such as
# --stats, are passed on to `choreobs run`.
#
#   case-study/run.sh case-study/1-greenhouse/step2-pump-on-host [--stats]
set -e
cd "$1"
shift
if [ ! -d workspace ]; then
  for e in $(node -e 'for (const e of require("./choreobs.json").endpoints) console.log(e.name)'); do
    choreobs add-endpoint "$e" > /dev/null
  done
fi
exec choreobs run "$@"
