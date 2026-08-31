#!/usr/bin/env bash
# Isolated Vicinae test rig: headless sway + its own vicinae server, fully
# separate XDG dirs so the real desktop instance is never touched.
#
#   ./test-rig.sh start          # build extension, start rig
#   ./test-rig.sh deploy         # rebuild extension, restart rig server
#   ./test-rig.sh cmd <args...>  # run `vicinae ...` against the rig
#   ./test-rig.sh type "text"    # type into the rig launcher
#   ./test-rig.sh key Return     # press a key in the rig
#   ./test-rig.sh shot out.png   # screenshot the rig display
#   ./test-rig.sh stop           # tear everything down
#
# Gotchas learned the hard way:
# - Processes started from an agent/tool shell get killed on exit; use
#   transient systemd user units instead.
# - systemd-run needs the REAL XDG_RUNTIME_DIR to find the user bus; pass rig
#   env via -p Environment=..., never `source` the rig env first.
# - The headless seat has no input devices, so the layer-shell launcher never
#   gets keyboard focus. A long-lived wtype (the "kbd holder") keeps a virtual
#   keyboard attached; (re)open the launcher after it exists.

set -euo pipefail
RIG=/tmp/vicinae-rig
SRC="$(cd "$(dirname "$0")" && pwd)"
EXT_NAME=quick-ai

rigenv() {
  env XDG_RUNTIME_DIR=$RIG/run XDG_CONFIG_HOME=$RIG/config \
      XDG_DATA_HOME=$RIG/data XDG_CACHE_HOME=$RIG/cache \
      WAYLAND_DISPLAY=wayland-1 "$@"
}

unit() { # unit NAME [extra -p args...] -- cmd...
  local name=$1; shift
  systemctl --user reset-failed "vicinae-rig-$name" 2>/dev/null || true
  systemd-run --user --unit="vicinae-rig-$name" --collect \
    -p Environment=XDG_RUNTIME_DIR=$RIG/run \
    -p Environment=XDG_CONFIG_HOME=$RIG/config \
    -p Environment=XDG_DATA_HOME=$RIG/data \
    -p Environment=XDG_CACHE_HOME=$RIG/cache \
    "$@"
}

case "${1:-}" in
start)
  mkdir -p $RIG/{run,config/vicinae,data/vicinae/extensions,cache}
  chmod 700 $RIG/run
  printf 'output HEADLESS-1 resolution 1280x800\n' > $RIG/sway.conf
  cat > $RIG/config/vicinae/settings.json <<'EOF'
{
  "fallbacks": ["@njpatel/quick-ai:ask"],
  "providers": { "files": { "enabled": false, "preferences": { "autoIndexing": false } } }
}
EOF
  (cd "$SRC" && npx vici build -o $RIG/data/vicinae/extensions/$EXT_NAME)
  unit sway \
    -p Environment=WLR_BACKENDS=headless \
    -p Environment=WLR_LIBINPUT_NO_DEVICES=1 \
    -p Environment=WLR_RENDERER=pixman \
    -p UnsetEnvironment="WAYLAND_DISPLAY DISPLAY SWAYSOCK" \
    /usr/bin/sway -c $RIG/sway.conf
  sleep 2
  unit server \
    -p Environment=WAYLAND_DISPLAY=wayland-1 \
    -p Environment=QT_QPA_PLATFORM=wayland \
    -p Environment=PATH=/usr/bin:/usr/local/bin:$HOME/.local/share/mise/shims \
    -p UnsetEnvironment=DISPLAY \
    /usr/bin/vicinae server
  unit kbd -p Environment=WAYLAND_DISPLAY=wayland-1 \
    /usr/bin/wtype -s 3600000 -k F24
  sleep 3
  rigenv vicinae ping && echo "rig up — display HEADLESS-1, socket in $RIG/run"
  ;;
deploy)
  (cd "$SRC" && npx vici build -o $RIG/data/vicinae/extensions/$EXT_NAME)
  systemctl --user restart vicinae-rig-server
  sleep 3
  rigenv vicinae ping
  ;;
cmd)   shift; rigenv vicinae "$@" ;;
type)  shift; rigenv wtype -d 20 "$*" ;;
key)   shift; rigenv wtype -k "$1" ;;
shot)  shift; rigenv grim "${1:-$RIG/shot.png}" && echo "${1:-$RIG/shot.png}" ;;
stop)
  systemctl --user stop vicinae-rig-server vicinae-rig-kbd vicinae-rig-sway 2>/dev/null || true
  echo "rig stopped ($RIG left on disk)"
  ;;
*)
  grep -E '^#   ' "$0" | sed 's/^#   //'
  ;;
esac
