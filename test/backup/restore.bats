#!/usr/bin/env bats
# Argument parsing, confirmation and ordering of deploy/server/backup/restore.sh, with a fake docker.
# Run: docker run --rm -v "$PWD:/mnt" -w /mnt bats/bats:latest test/backup

setup() {
  T="$BATS_TEST_TMPDIR"
  mkdir -p "$T/bin"
  export CALLS="$T/calls.log"
  : >"$CALLS"
  export PATH="$T/bin:$PATH"
  # Fake docker: logs every call; `cat` of a volume file prints a PGDMP archive, `ls` lists two.
  cat >"$T/bin/docker" <<'F'
#!/bin/sh
echo "docker $*" >>"$CALLS"
case "$*" in
  *"--entrypoint ls"*) printf 'orch-20261020T030000Z.dump\norch-20261021T030000Z.dump\nnotes.txt\n' ;;
  *"--entrypoint cat"*) printf 'PGDMPfake' ;;
  *"age -d"*) printf 'PGDMPdecrypted' ;;
  *"compose config --images"*) printf 'postgres:15-alpine\nghcr.io/selfhostr/orch-server:0.9\n' ;;
  *"exec -T postgres sh -c pg_restore --list"*) cat >"$CALLS.list"; [ -z "${FAKE_LIST_FAIL:-}" ] || exit 1 ;;
  *"exec -i orch-restore-verify"*"pg_restore --list"*) cat >/dev/null; [ -z "${FAKE_LIST_FAIL:-}" ] || exit 1 ;;
  *"exec -i orch-restore-verify"*) cat >"$CALLS.stdin"; [ -z "${FAKE_RESTORE_FAIL:-}" ] || exit 1 ;;
  *"to_regclass"*) [ -n "${FAKE_NO_MIGRATIONS:-}" ] && echo f || echo t ;;
  *"count(*) from information_schema"*) echo 7 ;;
  *"query_to_xml"*) printf 'Project 3\n_prisma_migrations 12\n' ;;
  *"exec -T postgres"*) cat >"$CALLS.stdin"; [ -z "${FAKE_RESTORE_KILL:-}" ] || { kill -TERM "$PPID"; sleep 0.3; }; [ -z "${FAKE_RESTORE_FAIL:-}" ] || exit 1 ;;
esac
exit 0
F
  chmod +x "$T/bin/docker"
  R="$BATS_TEST_DIRNAME/../../deploy/server/backup/restore.sh"
}

@test "--help prints usage and exits 0" {
  run sh "$R" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"usage: restore.sh"* ]]
}

@test "unknown option and extra arguments are refused" {
  run sh "$R" --nope
  [ "$status" -eq 1 ]
  run sh "$R" a b
  [ "$status" -eq 1 ]
}

@test "--list lists the volume and changes nothing" {
  run sh "$R" --list
  [ "$status" -eq 0 ]
  [[ "$output" == *"orch-20261021T030000Z.dump"* ]]
  ! grep -q 'stop server' "$CALLS" || false
}

@test "--yes restores the newest dump: stop, pg_restore single transaction, start" {
  run sh "$R" --yes
  [ "$status" -eq 0 ]
  grep -q 'cat backup /backups/orch-20261021T030000Z.dump' "$CALLS"
  [ "$(cat "$CALLS.stdin")" = "PGDMPfake" ]
  stop="$(grep -n 'stop server' "$CALLS" | cut -d: -f1)"
  rest="$(grep -n 'exec -T postgres sh -c pg_restore --clean' "$CALLS" | cut -d: -f1)"
  start="$(grep -n 'up -d server' "$CALLS" | cut -d: -f1)"
  [ "$stop" -lt "$rest" ] && [ "$rest" -lt "$start" ]
  grep -q -- '--clean --if-exists' "$CALLS"
  grep -q -- '--single-transaction' "$CALLS"
}

@test "without --yes, anything but 'restore' aborts before stopping the server" {
  run sh -c "echo no | sh '$R'"
  [ "$status" -eq 1 ]
  [[ "$output" == *"aborted"* ]]
  ! grep -q 'stop server' "$CALLS" || false
}

@test "without --yes, typing 'restore' proceeds" {
  run sh -c "echo restore | sh '$R' orch-20261020T030000Z.dump"
  [ "$status" -eq 0 ]
  grep -q '/backups/orch-20261020T030000Z.dump' "$CALLS"
  grep -q 'up -d server' "$CALLS"
}

@test "a local file is used as is" {
  printf 'PGDMPlocal' >"$BATS_TEST_TMPDIR/my.dump"
  run sh "$R" --yes "$BATS_TEST_TMPDIR/my.dump"
  [ "$status" -eq 0 ]
  [ "$(cat "$CALLS.stdin")" = "PGDMPlocal" ]
  ! grep -q 'entrypoint cat' "$CALLS" || false
}

@test "a file that is not a pg_dump archive is refused before the server is stopped" {
  echo garbage >"$BATS_TEST_TMPDIR/bad.dump"
  run sh "$R" --yes "$BATS_TEST_TMPDIR/bad.dump"
  [ "$status" -eq 1 ]
  [[ "$output" == *"not a pg_dump"* ]]
  ! grep -q 'stop server' "$CALLS" || false
}

@test "path traversal in the volume file name is refused" {
  run sh "$R" --yes ../etc/passwd
  [ "$status" -eq 1 ]
  ! grep -q 'stop server' "$CALLS" || false
}

@test "an .age dump needs --identity, then is decrypted in the backup container" {
  run sh "$R" --yes orch-20261021T030000Z.dump.age
  [ "$status" -eq 1 ]
  [[ "$output" == *"--identity"* ]]
  echo AGE-SECRET-KEY-X >"$BATS_TEST_TMPDIR/key.txt"
  run sh "$R" --yes --identity "$BATS_TEST_TMPDIR/key.txt" orch-20261021T030000Z.dump.age
  [ "$status" -eq 0 ]
  grep -q 'age -d -i' "$CALLS"
  # the private key never appears in the docker command line
  ! grep -q 'AGE-SECRET-KEY' "$CALLS" || false
  grep -q -- '-e ORCH_AGE_IDENTITY' "$CALLS"
  grep -q -- '--user 70:70' "$CALLS"
  [ "$(cat "$CALLS.stdin")" = "PGDMPdecrypted" ]
}

@test "a failed pg_restore says so and starts the server again" {
  FAKE_RESTORE_FAIL=1 run sh "$R" --yes
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAILED"* ]]
  rest="$(grep -n 'exec -T postgres sh -c pg_restore --clean' "$CALLS" | cut -d: -f1)"
  start="$(grep -n 'up -d server' "$CALLS" | cut -d: -f1)"
  [ -n "$start" ] && [ "$rest" -lt "$start" ]
}

@test "an interrupted restore (TERM after the server was stopped) starts the server again" {
  FAKE_RESTORE_KILL=1 run sh "$R" --yes
  [ "$status" -ne 0 ]
  grep -q 'up -d server' "$CALLS"
}

@test "the dump is checked with pg_restore --list before the server is stopped" {
  run sh "$R" --yes
  [ "$status" -eq 0 ]
  [ "$(cat "$CALLS.list")" = "PGDMPfake" ]
  list="$(grep -n 'pg_restore --list' "$CALLS" | head -n 1 | cut -d: -f1)"
  stop="$(grep -n 'stop server' "$CALLS" | cut -d: -f1)"
  [ "$list" -lt "$stop" ]
}

@test "an unreadable dump is refused before the server is stopped" {
  FAKE_LIST_FAIL=1 run sh "$R" --yes
  [ "$status" -eq 1 ]
  [[ "$output" == *"Nothing was changed"* ]]
  ! grep -q 'stop server' "$CALLS" || false
}

@test "an interrupted restore says where it stands" {
  FAKE_RESTORE_KILL=1 run sh "$R" --yes
  [ "$status" -ne 0 ]
  [[ "$output" == *"should be unchanged"* ]]
}

@test "--verify restores into a throwaway postgres and never touches the server or the database" {
  run sh "$R" --verify
  [ "$status" -eq 0 ]
  [[ "$output" == *"_prisma_migrations present, 7 tables"* ]]
  [[ "$output" == *"Project"* ]]
  [[ "$output" == *"is a good backup"* ]]
  grep -q 'docker run -d --name orch-restore-verify-.* --network none .*postgres:15-alpine' "$CALLS"
  [ "$(cat "$CALLS.stdin")" = "PGDMPfake" ]
  # backups volume mounted read-only through an override file
  grep -q -- '-f compose.yaml -f .*ro.yaml' "$CALLS"
  # production untouched
  ! grep -q 'stop server' "$CALLS" || false
  ! grep -q 'up -d server' "$CALLS" || false
  ! grep -q 'exec -T postgres' "$CALLS" || false
  # the scratch container is removed with its volume
  grep -q 'docker rm -fv orch-restore-verify-' "$CALLS"
}

@test "--verify removes the throwaway postgres when the restore fails" {
  FAKE_RESTORE_FAIL=1 run sh "$R" --verify
  [ "$status" -eq 1 ]
  [[ "$output" == *"VERIFY FAILED"* ]]
  grep -q 'docker rm -fv orch-restore-verify-' "$CALLS"
  ! grep -q 'stop server' "$CALLS" || false
}

@test "--verify fails when _prisma_migrations is missing" {
  FAKE_NO_MIGRATIONS=1 run sh "$R" --verify
  [ "$status" -eq 1 ]
  [[ "$output" == *"_prisma_migrations is missing"* ]]
  grep -q 'docker rm -fv orch-restore-verify-' "$CALLS"
}

@test "--verify decrypts an .age dump like a normal restore" {
  echo AGE-SECRET-KEY-X >"$BATS_TEST_TMPDIR/key.txt"
  run sh "$R" --verify --identity "$BATS_TEST_TMPDIR/key.txt" orch-20261021T030000Z.dump.age
  [ "$status" -eq 0 ]
  [ "$(cat "$CALLS.stdin")" = "PGDMPdecrypted" ]
  ! grep -q 'AGE-SECRET-KEY' "$CALLS" || false
}

@test "the staging directory is removed on exit" {
  run env ORCH_RESTORE_TMPDIR="$BATS_TEST_TMPDIR" sh "$R" --verify
  [ "$status" -eq 0 ]
  [ -z "$(ls -A "$BATS_TEST_TMPDIR" | grep '^\.restore\.' || true)" ]
}
