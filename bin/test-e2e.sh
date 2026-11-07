#!/bin/bash
exec "$(dirname "$(readlink -f "$0")")/../e2e/bin/run-tests.sh" "$@"
