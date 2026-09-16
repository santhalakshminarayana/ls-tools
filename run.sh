#!/bin/sh

set -eu

script_path=$0
while [ -L "$script_path" ]; do
	link_target=$(readlink "$script_path")
	case "$link_target" in
		/*) script_path=$link_target ;;
		*) script_path=$(dirname -- "$script_path")/$link_target ;;
	esac
done
project_dir=$(CDPATH= cd -- "$(dirname -- "$script_path")" && pwd)
url="http://127.0.0.1:8787/"
build_dir="${TMPDIR:-/tmp}/ls-tools"
server_binary="$build_dir/ls-tools-server"
server_pid=""

cleanup() {
	trap - EXIT HUP INT TERM
	if [ -n "$server_pid" ] && kill -0 "$server_pid" 2>/dev/null; then
		kill "$server_pid" 2>/dev/null || true
		wait "$server_pid" 2>/dev/null || true
	fi
}

open_browser() {
	case "$(uname -s)" in
		Darwin)
			if command -v open >/dev/null 2>&1 && open "$url" >/dev/null 2>&1; then
				return 0
			fi
			;;
		Linux)
			if command -v xdg-open >/dev/null 2>&1; then
				xdg-open "$url" >/dev/null 2>&1 &
				return 0
			fi
			;;
	esac

	printf 'Open LS Tools at %s\n' "$url"
}

trap cleanup EXIT HUP INT TERM

# Reuse an already-running LS Tools server instead of failing on its port.
if curl --fail --silent --show-error --max-time 1 "$url" >/dev/null 2>&1; then
	printf 'LS Tools is already running at %s\n' "$url"
	open_browser
	exit 0
fi

mkdir -p "$build_dir"
cd "$project_dir"

printf 'Building LS Tools...\n'
go build -o "$server_binary" .

"$server_binary" &
server_pid=$!

# Do not open the browser until the HTTP server is accepting requests.
attempt=0
while [ "$attempt" -lt 100 ]; do
	if curl --fail --silent --show-error --max-time 1 "$url" >/dev/null 2>&1; then
		printf 'Opening LS Tools at %s\n' "$url"
		open_browser
		printf 'LS Tools is running. Press Ctrl+C to stop it.\n'
		wait "$server_pid"
		exit $?
	fi

	if ! kill -0 "$server_pid" 2>/dev/null; then
		wait "$server_pid"
		exit $?
	fi

	attempt=$((attempt + 1))
	sleep 0.1
done

printf 'LS Tools did not become ready at %s\n' "$url" >&2
exit 1
