#!/bin/sh
# Restore a backup into the running production stack. Run it on the host, from anywhere:
#
#   backup/restore.sh [--verify] [--yes] [--identity AGE_KEY_FILE] [--list] [DUMP]
#
# DUMP is "latest" (default), a file name in the `backups` volume (orch-<stamp>.dump[.age]) or the
# path of a dump on this host (for example one downloaded from S3). Encrypted dumps (.age) need
# --identity (the age private key file). The database content is REPLACED: the server is stopped,
# pg_restore --clean --if-exists runs in a single transaction (all or nothing), then the server is
# started again and its entrypoint runs `prisma migrate deploy`.
#
# With --verify the dump is restored into a throwaway Postgres container (same major version as the
# compose file, no network, removed on exit) and checked. The running server and database are never
# touched and the backups volume is mounted read-only. Use it to test a backup without any risk.
#
# The dump is staged in a private temp dir created in deploy/server (removed on exit). Set
# ORCH_RESTORE_TMPDIR to stage it elsewhere (a directory with room for the dump).
set -eu

usage() {
  cat <<'EOF'
usage: restore.sh [--verify] [--yes] [--identity AGE_KEY_FILE] [--list] [DUMP]
  DUMP        latest (default), a file name in the backups volume, or a local file path
  --identity  age private key file, required for .age dumps
  --verify    restore into a throwaway Postgres and check it; production is not touched
  --yes, -y   do not ask for confirmation
  --list      list the dumps in the backups volume and exit
  --help, -h  this help
EOF
}

die() {
  printf 'restore: %s\n' "$*" >&2
  exit 1
}

YES=false
VERIFY=false
LIST=false
IDENTITY=""
DUMP=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -y | --yes) YES=true ;;
    --list) LIST=true ;;
    --verify) VERIFY=true ;;
    --identity)
      [ "$#" -ge 2 ] || die "--identity needs a file"
      IDENTITY="$2"
      shift
      ;;
    --identity=*) IDENTITY="${1#--identity=}" ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      usage >&2
      die "unknown option: $1"
      ;;
    *)
      [ -z "$DUMP" ] || die "only one DUMP argument is allowed"
      DUMP="$1"
      ;;
  esac
  shift
done
DUMP="${DUMP:-latest}"

# The compose project is deploy/server, the parent of this script's directory.
cd "$(dirname "$0")/.."
[ -f compose.yaml ] || die "compose.yaml not found next to backup/"

dc() { docker compose "$@"; }
# Run a command in the backup image without starting its dependencies. stdin stays attached.
# As uid 70, the owner of the dumps (the container has no capability to read other users' files).
# The volume is mounted read-only: this script only ever reads dumps.
in_backup() {
  [ -f "$TMP/ro.yaml" ] || printf 'services:\n  backup:\n    volumes:\n      - "%s:/backups:ro"\n' "${BACKUP_VOLUME:-backups}" >"$TMP/ro.yaml"
  docker compose -f compose.yaml -f "$TMP/ro.yaml" run --rm --no-deps -T --user 70:70 "$@"
}

list_volume() { in_backup --entrypoint ls backup -1 /backups | sort; }

# Temp dir on disk next to compose.yaml (or ORCH_RESTORE_TMPDIR), not in /tmp: a dump can be
# larger than a tmpfs /tmp.
TMP="$(mktemp -d "${ORCH_RESTORE_TMPDIR:-$PWD}/.restore.XXXXXX")"
SERVER_STOPPED=false
RESTORING=false
SCRATCH=""
# Whatever happens (failure, Ctrl-C), remove what we created and bring the server back if we stopped it.
cleanup() {
  rc=$?
  trap - EXIT INT TERM
  rm -rf "$TMP"
  if [ -n "$SCRATCH" ]; then
    docker rm -fv "$SCRATCH" >/dev/null 2>&1 || true
  fi
  if $SERVER_STOPPED; then
    printf 'restore: starting server again\n' >&2
    if ! dc up -d server >&2; then
      printf 'restore: could not start the server, run: docker compose up -d server\n' >&2
    fi
    if $RESTORING && [ "$rc" -ne 0 ]; then
      printf 'restore: interrupted or failed during pg_restore. It runs in one transaction, so the database\n' >&2
      printf 'restore: should be unchanged; check it, and rerun after fixing the cause.\n' >&2
    fi
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
umask 077

if $LIST; then
  list_volume
  exit 0
fi

# Restore into a throwaway Postgres (same image as the compose file, no network) and check the result.
verify_dump() {
  major="$(dc config --images 2>/dev/null | sed -n 's/^postgres:\([0-9][0-9]*\)-alpine$/\1/p' | head -n 1)"
  major="${major:-${POSTGRES_MAJOR:-16}}"
  SCRATCH="orch-restore-verify-$$"
  pw="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  printf 'restore: verifying %s in a throwaway postgres:%s-alpine (production is not touched)\n' "$NAME" "$major"
  docker run -d --name "$SCRATCH" --network none -e POSTGRES_USER=orch -e POSTGRES_DB=orch \
    -e POSTGRES_PASSWORD="$pw" "postgres:${major}-alpine" \
    -c fsync=off -c synchronous_commit=off -c full_page_writes=off >/dev/null ||
    die "cannot start the throwaway postgres"
  n=0
  until docker exec "$SCRATCH" pg_isready -q -h 127.0.0.1 -U orch -d orch; do
    n=$((n + 1))
    [ "$n" -lt 60 ] || die "the throwaway postgres did not become ready"
    sleep 1
  done
  docker exec -i "$SCRATCH" pg_restore --list >/dev/null <"$TMP/dump" ||
    die "pg_restore cannot read $NAME (corrupt or truncated dump?)"
  start="$(date +%s)"
  docker exec -i "$SCRATCH" pg_restore --no-owner --exit-on-error -U orch -d orch <"$TMP/dump" ||
    die "VERIFY FAILED: pg_restore reported errors for $NAME"
  printf 'restore: restored without error in %s s\n' "$(($(date +%s) - start))"
  has_mig="$(docker exec "$SCRATCH" psql -U orch -d orch -tA -c "select to_regclass('public._prisma_migrations') is not null")"
  tables="$(docker exec "$SCRATCH" psql -U orch -d orch -tA -c "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")"
  [ "$has_mig" = t ] || die "VERIFY FAILED: table _prisma_migrations is missing (is this an orch dump?)"
  [ "${tables:-0}" -gt 0 ] || die "VERIFY FAILED: no tables in the restored database"
  printf 'restore: _prisma_migrations present, %s tables. Row counts:\n' "$tables"
  docker exec "$SCRATCH" psql -U orch -d orch -tA -F ' ' -c "select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1" |
    awk '{ printf "  %-32s %s\n", $1, $2 }' || die "VERIFY FAILED: cannot count rows"
  printf 'restore: OK, %s is a good backup. The throwaway postgres is removed.\n' "$NAME"
}

# 1. Locate the dump and copy it to a private temp file on the host.
if [ -f "$DUMP" ]; then
  NAME="$(basename "$DUMP")"
  cp "$DUMP" "$TMP/src"
else
  if [ "$DUMP" = latest ]; then
    NAME="$(list_volume | grep -E '^orch-.*\.dump(\.age)?$' | tail -n 1 || true)"
    [ -n "$NAME" ] || die "no backup found in the backups volume"
  else
    NAME="$DUMP"
    case "$NAME" in */* | *..*) die "not a file name in the backups volume: $NAME" ;; esac
  fi
  in_backup --entrypoint cat backup "/backups/$NAME" >"$TMP/src" || die "cannot read $NAME from the backups volume"
fi

# 2. Decrypt if needed.
case "$NAME" in
  *.age)
    [ -n "$IDENTITY" ] || die "$NAME is encrypted: pass --identity AGE_KEY_FILE"
    [ -r "$IDENTITY" ] || die "cannot read identity file: $IDENTITY"
    # The key travels in an environment variable (not in argv, not on a bind mount: a 0600 key of
    # the host user would be unreadable for uid 70) and is written to the container's tmpfs.
    ORCH_AGE_IDENTITY="$(cat "$IDENTITY")"
    export ORCH_AGE_IDENTITY
    # shellcheck disable=SC2016 # expanded inside the container
    in_backup -e ORCH_AGE_IDENTITY --entrypoint sh backup -c \
      'umask 077; printf "%s\n" "$ORCH_AGE_IDENTITY" >/tmp/identity; age -d -i /tmp/identity' \
      <"$TMP/src" >"$TMP/dump" || die "decryption failed (wrong key?)"
    unset ORCH_AGE_IDENTITY
    ;;
  *) mv "$TMP/src" "$TMP/dump" ;;
esac

# 3. Refuse anything that is not a pg_dump custom-format archive, before touching the database.
[ "$(head -c 5 "$TMP/dump")" = "PGDMP" ] || die "$NAME is not a pg_dump custom-format archive"

# 4. The archive must be readable by pg_restore, checked before anything is stopped or replaced.
# shellcheck disable=SC2016 # runs inside the container
if ! $VERIFY && ! dc exec -T postgres sh -c 'pg_restore --list >/dev/null' <"$TMP/dump"; then
  die "pg_restore cannot read $NAME (corrupt or truncated dump?). Nothing was changed."
fi

if $VERIFY; then
  verify_dump
  exit $?
fi

# 5. Confirm.
if ! $YES; then
  printf 'This REPLACES the whole orch database with %s.\n' "$NAME"
  printf 'The server is stopped meanwhile (about one to two minutes for a small database). Type "restore" to continue: '
  read -r answer || answer=""
  [ "$answer" = restore ] || die "aborted, nothing changed"
fi

# 6. Restore. The server must not write while we do.
printf 'restore: stopping server\n'
SERVER_STOPPED=true
dc stop server
printf 'restore: restoring %s\n' "$NAME"
RESTORING=true
# shellcheck disable=SC2016 # $POSTGRES_* must expand inside the container
if ! dc exec -T postgres sh -c \
  'pg_restore --clean --if-exists --no-owner --single-transaction --exit-on-error -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  <"$TMP/dump"; then
  printf 'restore: pg_restore FAILED, the database was left unchanged (single transaction).\n' >&2
  exit 1
fi
RESTORING=false

# 7. Start the server: its entrypoint runs `prisma migrate deploy`, which upgrades an older dump.
printf 'restore: starting server (applies pending migrations)\n'
dc up -d server
SERVER_STOPPED=false
printf 'restore: done. Check: docker compose logs -f server\n'
