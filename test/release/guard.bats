#!/usr/bin/env bats
# Run: docker run --rm -v "$PWD:/mnt" -w /mnt bats/bats:latest test/release

setup() {
  T="$BATS_TEST_TMPDIR"
  mkdir -p "$T/bin"
  export PATH="$T/bin:$PATH"
  export GITHUB_OUTPUT="$T/out"
  : >"$GITHUB_OUTPUT"
  S="$BATS_TEST_DIRNAME/../../scripts/release-guard.sh"
  # Fake gh: prints the workflow runs listed in $RUNS (name<TAB>conclusion per line).
  cat >"$T/bin/gh" <<'F'
#!/bin/sh
printf '%s\n' "$RUNS"
F
  chmod +x "$T/bin/gh"
  # Fake git (the bats image has none): `merge-base --is-ancestor` answers like the SHA below.
  cat >"$T/bin/git" <<'F'
#!/bin/sh
[ "$1 $2" = "merge-base --is-ancestor" ] && [ "$3" = "aaaa" ]
F
  chmod +x "$T/bin/git"
  ON_MAIN=aaaa
  OFF_MAIN=bbbb
  GREEN="$(printf 'CI\tsuccess\nCodeQL\tsuccess\nScorecard supply-chain security\tskipped')"
}

@test "passes for a stable tag on main with green CI" {
  RUNS="$GREEN" run sh "$S" v1.2.3 "$ON_MAIN" o/r
  [ "$status" -eq 0 ]
  grep -qx 'stable=true' "$GITHUB_OUTPUT"
}

@test "a pre-release tag passes but is not stable" {
  RUNS="$GREEN" run sh "$S" v1.2.3-rc.1 "$ON_MAIN" o/r
  [ "$status" -eq 0 ]
  grep -qx 'stable=false' "$GITHUB_OUTPUT"
}

@test "refuses a commit that is not on main" {
  RUNS="$GREEN" run sh "$S" v1.2.3 "$OFF_MAIN" o/r
  [ "$status" -eq 1 ]
  case "$output" in *"not on main"*) true ;; *) false ;; esac
}

@test "refuses a failed CI run" {
  RUNS="$(printf 'CI\tfailure\nCodeQL\tsuccess')" run sh "$S" v1.2.3 "$ON_MAIN" o/r
  [ "$status" -eq 1 ]
  case "$output" in *"CI: failure"*) true ;; *) false ;; esac
}

@test "refuses a run that has not finished" {
  RUNS="$(printf 'CI\tsuccess\nCodeQL\tpending')" run sh "$S" v1.2.3 "$ON_MAIN" o/r
  [ "$status" -eq 1 ]
}

@test "refuses a commit with no CI run" {
  RUNS="" run sh "$S" v1.2.3 "$ON_MAIN" o/r
  [ "$status" -eq 1 ]
  case "$output" in *"no CI run"*) true ;; *) false ;; esac
}

@test "refuses a tag that is not a version" {
  RUNS="$GREEN" run sh "$S" vnext "$ON_MAIN" o/r
  [ "$status" -eq 1 ]
}
