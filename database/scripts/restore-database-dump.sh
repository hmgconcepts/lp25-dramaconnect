#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: BACKUP_PASSPHRASE=... RESTORE_CONFIRM=RESTORE \
  scripts/restore-database-dump.sh \
  PUBLIC.dump.gpg PUBLIC.dump.gpg.sha256 \
  AUTH.data.dump.gpg AUTH.data.dump.gpg.sha256 \
  TARGET_DB_URL --apply

Verifies both encrypted-file checksums, decrypts to protected temporary files,
validates the catalogs, restores data-only Auth identities to an empty Auth
target, then atomically clean-restores the public application schema.

Set SKIP_AUTH_RESTORE=1 only when the target already has the exact Auth user
UUIDs (for example, while retrying the public phase after Auth succeeded).
Read docs/BACKUP_AND_RECOVERY.md before use. This operation is destructive.
EOF
}

[[ $# -eq 6 && "$6" == '--apply' ]] || { usage; exit 2; }
public_encrypted="$1"
public_checksum="$2"
auth_encrypted="$3"
auth_checksum="$4"
target="$5"
for file in "$public_encrypted" "$public_checksum" "$auth_encrypted" "$auth_checksum"; do
  [[ -f "$file" ]] || { echo "Backup component not found: $file" >&2; exit 2; }
done
[[ -n "${BACKUP_PASSPHRASE:-}" ]] || { echo 'BACKUP_PASSPHRASE is required.' >&2; exit 2; }
[[ "${RESTORE_CONFIRM:-}" == 'RESTORE' ]] || { echo 'Set RESTORE_CONFIRM=RESTORE to acknowledge destructive restore.' >&2; exit 2; }
[[ "$target" == postgres://* || "$target" == postgresql://* ]] || { echo 'TARGET_DB_URL must be a PostgreSQL URL.' >&2; exit 2; }

for command in sha256sum gpg pg_restore psql; do command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 2; }; done

verify_checksum() {
  local encrypted="$1" checksum="$2" dir name
  dir="$(cd "$(dirname "$encrypted")" && pwd)"
  name="$(basename "$encrypted")"
  (cd "$dir" && grep "  $name\$" "$(basename "$checksum")" | sha256sum --check --status) \
    || { echo "Encrypted backup checksum verification failed: $name" >&2; exit 1; }
}
verify_checksum "$public_encrypted" "$public_checksum"
verify_checksum "$auth_encrypted" "$auth_checksum"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
umask 077
passfile="$tmp/passphrase"
public_plain="$tmp/public.dump"
auth_plain="$tmp/auth.data.dump"
printf '%s' "$BACKUP_PASSPHRASE" > "$passfile"
gpg --batch --yes --pinentry-mode loopback --passphrase-file "$passfile" --decrypt --output "$public_plain" "$public_encrypted"
gpg --batch --yes --pinentry-mode loopback --passphrase-file "$passfile" --decrypt --output "$auth_plain" "$auth_encrypted"
rm -f "$passfile"

pg_restore --list "$public_plain" > "$tmp/public.list"
pg_restore --list "$auth_plain" > "$tmp/auth.list"
grep -Eq 'TABLE DATA public profiles' "$tmp/public.list" || { echo 'Public dump does not contain DramaConnect profiles data.' >&2; exit 1; }
if grep -Eq 'TABLE DATA auth ' "$tmp/public.list"; then
  echo 'Unsafe catalog: the public dump unexpectedly contains Auth data.' >&2; exit 1
fi
grep -Eq 'TABLE DATA auth users' "$tmp/auth.list" || { echo 'Auth dump does not contain auth.users data.' >&2; exit 1; }
grep -Eq 'TABLE DATA auth identities' "$tmp/auth.list" || { echo 'Auth dump does not contain auth.identities data.' >&2; exit 1; }
if grep -Eq ' TABLE auth (users|identities) ' "$tmp/auth.list"; then
  echo 'Unsafe catalog: Auth backup contains table definitions rather than data only.' >&2; exit 1
fi

catalog_major() {
  local label="$1" catalog="$2" source_major producer_major
  source_major="$(sed -nE 's/^;[[:space:]]+Dumped from database version:? ([0-9]+).*/\1/p' "$catalog" | head -n1)"
  producer_major="$(sed -nE 's/^;[[:space:]]+Dumped by pg_dump version:? ([0-9]+).*/\1/p' "$catalog" | head -n1)"
  [[ "$source_major" =~ ^[0-9]+$ && "$producer_major" =~ ^[0-9]+$ ]] || {
    echo "$label catalog does not expose source/producer version metadata." >&2; exit 1
  }
  [[ "$source_major" == "$producer_major" ]] || {
    echo "$label backup was not produced by a source-version-matched pg_dump ($source_major vs $producer_major)." >&2; exit 1
  }
  printf '%s' "$source_major"
}
public_source_major="$(catalog_major Public "$tmp/public.list")"
auth_source_major="$(catalog_major Auth "$tmp/auth.list")"
[[ "$public_source_major" == "$auth_source_major" ]] || {
  echo 'Public and Auth catalogs were not created from the same PostgreSQL major version.' >&2; exit 1
}

echo "Checksums, decryption and both PostgreSQL $public_source_major dump catalogs validated."

psql "$target" -Xv ON_ERROR_STOP=1 -Atqc 'select 1' >/dev/null
server_num="$(psql "$target" -Xv ON_ERROR_STOP=1 -Atqc 'show server_version_num')"
[[ "$server_num" =~ ^[0-9]+$ ]] || { echo 'Could not determine target PostgreSQL version.' >&2; exit 1; }
target_major="$((server_num / 10000))"
restore_major="$(pg_restore --version | sed -nE 's/^pg_restore \(PostgreSQL\) ([0-9]+).*/\1/p')"
[[ "$restore_major" =~ ^[0-9]+$ ]] || { echo 'Could not determine pg_restore major version.' >&2; exit 1; }
[[ "$restore_major" == "$target_major" ]] || {
  echo "pg_restore major $restore_major does not match target PostgreSQL major $target_major." >&2
  echo "Install/use the PostgreSQL $target_major client before recovery." >&2
  exit 1
}
(( target_major >= public_source_major )) || {
  echo "Refusing to restore PostgreSQL $public_source_major catalogs into older PostgreSQL $target_major." >&2
  exit 1
}

if [[ "${SKIP_AUTH_RESTORE:-0}" == '1' ]]; then
  echo 'Skipping Auth restore as explicitly requested; exact target user UUIDs are your responsibility.'
else
  existing_auth="$(psql "$target" -Xv ON_ERROR_STOP=1 -Atqc 'select (select count(*) from auth.users)::text || '"'"':'"'"' || (select count(*) from auth.identities)::text')"
  [[ "$existing_auth" == '0:0' ]] || {
    echo "Target Auth users/identities are not empty ($existing_auth); refusing to merge credentials." >&2
    echo 'Use a fresh recovery project, or set SKIP_AUTH_RESTORE=1 only after independently confirming exact UUIDs.' >&2
    exit 1
  }
  echo 'Restoring Auth users and identities in one transaction (sessions/tokens are intentionally excluded).'
  pg_restore --dbname="$target" --data-only --schema=auth --no-owner --no-acl \
    --exit-on-error --single-transaction "$auth_plain"
fi

echo 'Starting clean, single-transaction public-schema restore. Do not interrupt it.'
pg_restore --dbname="$target" --schema=public --clean --if-exists --no-owner --no-acl \
  --exit-on-error --single-transaction "$public_plain"

profiles="$(psql "$target" -Xv ON_ERROR_STOP=1 -Atqc 'select count(*) from public.profiles')"
missing_users="$(psql "$target" -Xv ON_ERROR_STOP=1 -Atqc 'select count(*) from public.profiles p left join auth.users u on u.id=p.id where u.id is null')"
orphan_identities="$(psql "$target" -Xv ON_ERROR_STOP=1 -Atqc 'select count(*) from auth.identities i left join auth.users u on u.id=i.user_id where u.id is null')"
[[ "$missing_users" == '0' && "$orphan_identities" == '0' ]] || {
  echo "Recovery consistency check failed (profiles without users: $missing_users; identities without users: $orphan_identities)." >&2
  exit 1
}
echo "Database recovery completed; public.profiles contains $profiles row(s), with no detected Auth identity orphans."
echo 'Run every post-restore check in docs/BACKUP_AND_RECOVERY.md before opening access.'
