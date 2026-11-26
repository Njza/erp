#!/usr/bin/env bash
# Smoke test for login, RBAC and the error contract. Needs a running API and jq.
#   ./smoke.sh [base-url] [admin-password]
# shortcut: curl checks against a dev database, not a test project; move to
# WebApplicationFactory + Testcontainers when the first business module lands.
set -euo pipefail
API=${1:-http://localhost:5283/api}
ADMIN_PW=${2:-Admin@12345}
BODY_FILE=$(mktemp); trap 'rm -f "$BODY_FILE"' EXIT
BODY=

# check NAME WANT_STATUS WANT_CODE METHOD PATH TOKEN [JSON]   (WANT_CODE "-" = do not check)
# Leaves the response body in $BODY.
check() {
  local status
  status=$(curl -s -o "$BODY_FILE" -w '%{http_code}' -X "$4" "$API$5" \
    -H "Authorization: Bearer $6" -H 'Content-Type: application/json' -d "${7:-}")
  BODY=$(cat "$BODY_FILE")
  if [ "$status" != "$2" ] || { [ "$3" != - ] && [ "$(jq -r .code <<<"$BODY")" != "$3" ]; }; then
    echo "FAIL $1: got $status, want $2 $3. Body: $BODY"; exit 1
  fi
  echo "ok   $1"
}
login_json() { echo "{\"username\":\"$1\",\"password\":\"$2\"}"; }
S=$RANDOM
NEW_USER="\"displayName\":\"V\",\"password\":\"Viewer@12345\""

check "wrong password"            401 INVALID_CREDENTIALS POST /auth/login "" "$(login_json admin wrong-password)"
check "empty login is validated"  400 HTTP_400            POST /auth/login "" "$(login_json '' '')"
jq -e '.errors.Username' <<<"$BODY" >/dev/null || { echo "FAIL: no field errors"; exit 1; }
check "malformed JSON"            400 BAD_REQUEST         POST /auth/login "" "{bad"
check "no token"                  401 HTTP_401            GET  /users ""
check "unknown route"             404 HTTP_404            GET  /nope ""

check "admin login"               200 - POST /auth/login "" "$(login_json admin "$ADMIN_PW")"
ADMIN=$(jq -r .token <<<"$BODY")
check "admin lists users"         200 - GET /users "$ADMIN"
check "admin /me"                 200 - GET /auth/me "$ADMIN"
jq -e '.permissions | index("role.write")' <<<"$BODY" >/dev/null || { echo "FAIL: admin lacks role.write"; exit 1; }

# A role that can only read users, and a user that has only that role.
check "create role"               200 - POST /roles "$ADMIN" "{\"name\":\"viewer$S\",\"permissions\":[\"user.read\"]}"
ROLE=$(jq -r .id <<<"$BODY")
check "create user"               200 - POST /users "$ADMIN" "{\"username\":\"viewer$S\",$NEW_USER,\"roleIds\":[$ROLE]}"
USER_ID=$(jq -r .id <<<"$BODY")
check "duplicate username"        409 DUPLICATE           POST /users "$ADMIN" "{\"username\":\"viewer$S\",$NEW_USER,\"roleIds\":[]}"
check "short password"            400 HTTP_400            POST /users "$ADMIN" "{\"username\":\"x$S\",\"displayName\":\"V\",\"password\":\"123\",\"roleIds\":[]}"
check "unknown permission"        400 UNKNOWN_PERMISSION  POST /roles "$ADMIN" "{\"name\":\"bad$S\",\"permissions\":[\"nope\"]}"

check "viewer login"              200 - POST /auth/login "" "$(login_json "viewer$S" Viewer@12345)"
VIEWER=$(jq -r .token <<<"$BODY")
check "viewer may read users"     200 - GET /users "$VIEWER"
check "viewer may not write users" 403 FORBIDDEN          POST /users "$VIEWER" "{\"username\":\"y$S\",$NEW_USER,\"roleIds\":[]}"
check "viewer may not read roles" 403 FORBIDDEN           GET  /roles "$VIEWER"

check "role in use is not deleted" 409 IN_USE             DELETE "/roles/$ROLE" "$ADMIN"
check "admin role is read-only"   400 BUILT_IN_ROLE       PUT /roles/1 "$ADMIN" '{"name":"admin","permissions":[]}'

# Disabling a user must take effect on the token they already hold.
check "disable viewer"            204 - PUT "/users/$USER_ID" "$ADMIN" "{\"displayName\":\"Viewer\",\"isActive\":false,\"roleIds\":[$ROLE]}"
check "disabled user, old token"  403 FORBIDDEN           GET /users "$VIEWER"
check "disabled user cannot log in" 401 INVALID_CREDENTIALS POST /auth/login "" "$(login_json "viewer$S" Viewer@12345)"

echo "ALL PASSED"
