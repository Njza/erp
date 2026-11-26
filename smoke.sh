#!/usr/bin/env bash
# Smoke test for login, RBAC and the error contract. Needs a running API and jq.
#   ./smoke.sh [base-url] [admin-password]
# shortcut: curl checks against a dev database, not a test project; move to
# WebApplicationFactory + Testcontainers when the first business module lands.
set -euo pipefail
API=${1:-http://localhost:5283/api}
ADMIN_PW=${2:-Admin@12345}
BODY_FILE=$(mktemp); HEAD_FILE=$(mktemp); trap 'rm -f "$BODY_FILE" "$HEAD_FILE"' EXIT
BODY=

# check NAME WANT_STATUS WANT_CODE METHOD PATH TOKEN [JSON]   (WANT_CODE "-" = do not check)
# Leaves the response body in $BODY.
check() {
  local status
  status=$(curl -s -o "$BODY_FILE" -D "$HEAD_FILE" -w '%{http_code}' -X "$4" "$API$5" \
    -H "Authorization: Bearer $6" -H 'Content-Type: application/json' -d "${7:-}" \
    -H "X-Forwarded-For: 10.$((RANDOM % 250)).$((RANDOM % 250)).$((RANDOM % 250))") # a new client each time, so the login rate limit stays out of the way
  BODY=$(cat "$BODY_FILE")
  if [ "$status" != "$2" ] || { [ "$3" != - ] && [ "$(jq -r .code <<<"$BODY")" != "$3" ]; }; then
    echo "FAIL $1: got $status, want $2 $3. Body: $BODY"; exit 1
  fi
  echo "ok   $1"
}
# The token of the login that check() just made. It comes in a cookie, never in the body.
login_token() { tr -d '\r' <"$HEAD_FILE" | sed -n 's/^[Ss]et-[Cc]ookie: erp_token=\([^;]*\).*/\1/p'; }
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
ADMIN=$(login_token)
[ -n "$ADMIN" ] && grep -qi '^set-cookie: erp_token=.*httponly' "$HEAD_FILE" || { echo "FAIL: login did not set an HttpOnly cookie"; exit 1; }
[ "$(jq -r '.token // empty' <<<"$BODY")" = "" ] || { echo "FAIL: login returned the token in the body"; exit 1; }
# The cookie counts only together with the X-Requested-With header (CSRF).
cookie_status() { curl -s -o /dev/null -w '%{http_code}' -X "$1" "$API$2" -H "Cookie: erp_token=$ADMIN" "${@:3}"; }
[ "$(cookie_status GET /auth/me)" = 401 ] || { echo "FAIL: cookie accepted without the CSRF header"; exit 1; }
[ "$(cookie_status POST /users -H 'Content-Type: application/json' -d '{}')" = 401 ] || { echo "FAIL: POST with cookie accepted without the CSRF header"; exit 1; }
[ "$(cookie_status GET /auth/me -H 'X-Requested-With: erp')" = 200 ] || { echo "FAIL: cookie with the CSRF header refused"; exit 1; }
echo "ok   cookie login and CSRF header"
check "logout"                    204 - POST /auth/logout ""
grep -qi '^set-cookie: erp_token=;' "$HEAD_FILE" || { echo "FAIL: logout did not remove the cookie"; exit 1; }
check "admin lists users"         200 - GET /users "$ADMIN"
check "admin /me"                 200 - GET /auth/me "$ADMIN"
jq -e '.permissions | index("role.write")' <<<"$BODY" >/dev/null || { echo "FAIL: admin lacks role.write"; exit 1; }
check "version"                   200 - GET /version "$ADMIN"
jq -e '.version | length > 0' <<<"$BODY" >/dev/null || { echo "FAIL: no version"; exit 1; }

# A role that can only read users, and a user that has only that role.
check "create role"               200 - POST /roles "$ADMIN" "{\"name\":\"viewer$S\",\"permissions\":[\"user.read\"]}"
ROLE=$(jq -r .id <<<"$BODY")
check "create user"               200 - POST /users "$ADMIN" "{\"username\":\"viewer$S\",$NEW_USER,\"roleIds\":[$ROLE]}"
USER_ID=$(jq -r .id <<<"$BODY")
check "duplicate username"        409 DUPLICATE           POST /users "$ADMIN" "{\"username\":\"viewer$S\",$NEW_USER,\"roleIds\":[]}"
check "short password"            400 HTTP_400            POST /users "$ADMIN" "{\"username\":\"x$S\",\"displayName\":\"V\",\"password\":\"123\",\"roleIds\":[]}"
check "unknown permission"        400 UNKNOWN_PERMISSION  POST /roles "$ADMIN" "{\"name\":\"bad$S\",\"permissions\":[\"nope\"]}"

check "viewer login"              200 - POST /auth/login "" "$(login_json "viewer$S" Viewer@12345)"
VIEWER=$(login_token)
check "viewer may read users"     200 - GET /users "$VIEWER"
check "viewer may not write users" 403 FORBIDDEN          POST /users "$VIEWER" "{\"username\":\"y$S\",$NEW_USER,\"roleIds\":[]}"
check "viewer may not read roles" 403 FORBIDDEN           GET  /roles "$VIEWER"

check "role in use is not deleted" 409 IN_USE             DELETE "/roles/$ROLE" "$ADMIN"
check "admin role is read-only"   400 BUILT_IN_ROLE       PUT /roles/1 "$ADMIN" '{"name":"admin","permissions":[]}'

# Parts bills: save, server-side total, unique number, history search, permissions.
BILL_NO="T$S"
BILL="{\"no\":\"$BILL_NO\",\"date\":\"2026-01-02\",\"customer\":\"smoke$S\",\"handler\":\"h$S\",\"installer\":\"i$S\",\"settle\":true,\"warranty\":false,\"rows\":[{\"name\":\"a$S\",\"unit\":\"\",\"qty\":2,\"qtyUnit\":\"x\",\"price\":1.5},{\"name\":\"note only\"}]}"
check "create bill"               200 - POST /parts-bills "$ADMIN" "$BILL"
BILL_ID=$(jq -r .id <<<"$BODY")
check "duplicate bill number"     409 DUPLICATE           POST /parts-bills "$ADMIN" "$BILL"
check "read bill"                 200 - GET "/parts-bills/$BILL_ID" "$ADMIN"
jq -e '.total == 3 and (.rows | length) == 2 and .date == "2026-01-02"' <<<"$BODY" >/dev/null || { echo "FAIL: bill content: $BODY"; exit 1; }
check "update bill"               204 - PUT "/parts-bills/$BILL_ID" "$ADMIN" "${BILL/\"qty\":2/\"qty\":4}"
check "mark bill printed"         204 - POST "/parts-bills/$BILL_ID/printed" "$ADMIN"
check "mark bill printed again"   204 - POST "/parts-bills/$BILL_ID/printed" "$ADMIN"
check "printed missing bill"      404 NOT_FOUND           POST /parts-bills/999999/printed "$ADMIN"
check "search history"            200 - GET "/parts-bills?q=smoke$S" "$ADMIN"
jq -e '.total == 1 and .items[0].total == 6 and .items[0].printCount == 2 and .items[0].lastPrintedAt != null' <<<"$BODY" >/dev/null || { echo "FAIL: history: $BODY"; exit 1; }

# Saving a bill adds what it uses to the lists. A line with only a name is a note, not a product.
check "bill added its customer"   200 - GET /names/customer "$ADMIN"
jq -e --arg n "smoke$S" 'any(.[]; .name == $n)' <<<"$BODY" >/dev/null || { echo "FAIL: customer not added: $BODY"; exit 1; }
check "bill added its installer"  200 - GET /names/installer "$ADMIN"
jq -e --arg n "i$S" 'any(.[]; .name == $n)' <<<"$BODY" >/dev/null || { echo "FAIL: installer not added"; exit 1; }
check "bill added its handler"    200 - GET /names/handler "$ADMIN"
HANDLER_ID=$(jq -r --arg n "h$S" '.[] | select(.name == $n) | .id' <<<"$BODY")
[ -n "$HANDLER_ID" ] || { echo "FAIL: handler not added"; exit 1; }
check "bill added its part"       200 - GET /products "$ADMIN"
jq -e --arg n "a$S" 'any(.[]; .name == $n and .unit == "x") and (any(.[]; .name == "note only") | not)' <<<"$BODY" >/dev/null || { echo "FAIL: part not added, or a note was: $BODY"; exit 1; }
PART_ID=$(jq -r --arg n "a$S" '.[] | select(.name == $n) | .id' <<<"$BODY")

# Soft delete: gone from the lists; the bill keeps its text; saving the old bill again does not
# bring the value back; using it on a new bill does.
check "delete handler"            204 - DELETE "/names/handler/$HANDLER_ID" "$ADMIN"
check "delete part"               204 - DELETE "/products/$PART_ID" "$ADMIN"
check "deleted handler not listed" 200 - GET /names/handler "$ADMIN"
jq -e --arg n "h$S" 'any(.[]; .name == $n) | not' <<<"$BODY" >/dev/null || { echo "FAIL: deleted handler still listed"; exit 1; }
check "old bill keeps its text"   200 - GET "/parts-bills/$BILL_ID" "$ADMIN"
jq -e --arg h "h$S" --arg n "a$S" '.handler == $h and .rows[0].name == $n' <<<"$BODY" >/dev/null || { echo "FAIL: bill changed: $BODY"; exit 1; }
check "save old bill again"       204 - PUT "/parts-bills/$BILL_ID" "$ADMIN" "${BILL/\"qty\":2/\"qty\":4}"
check "still deleted after that"  200 - GET /products "$ADMIN"
jq -e --arg n "a$S" 'any(.[]; .name == $n) | not' <<<"$BODY" >/dev/null || { echo "FAIL: saving an old bill restored a deleted part"; exit 1; }
check "new bill uses them again"  200 - POST /parts-bills "$ADMIN" "${BILL/\"no\":\"$BILL_NO\"/\"no\":\"${BILL_NO}b\"}"
check "handler is back"           200 - GET /names/handler "$ADMIN"
jq -e --arg n "h$S" 'any(.[]; .name == $n)' <<<"$BODY" >/dev/null || { echo "FAIL: handler not restored"; exit 1; }
check "part is back"              200 - GET /products "$ADMIN"
jq -e --arg n "a$S" 'any(.[]; .name == $n)' <<<"$BODY" >/dev/null || { echo "FAIL: part not restored"; exit 1; }
check "viewer may not delete names" 403 FORBIDDEN         DELETE "/names/handler/$HANDLER_ID" "$VIEWER"

check "next number of a day"      200 - GET "/parts-bills/next-no?date=1999-01-02" "$ADMIN"
[ "$(jq -r .no <<<"$BODY")" = "1999010201" ] || { echo "FAIL: next number: $BODY"; exit 1; }
check "negative price"            400 INVALID_ROWS           POST /parts-bills "$ADMIN" "{\"no\":\"N$S\",\"date\":\"2026-01-02\",\"rows\":[{\"name\":\"a\",\"qty\":1,\"price\":-1}]}"
check "bill without number"       400 HTTP_400            POST /parts-bills "$ADMIN" "{\"no\":\"\",\"date\":\"2026-01-02\",\"rows\":[]}"
check "missing bill"              404 NOT_FOUND           GET /parts-bills/999999 "$ADMIN"
check "viewer may not read bills" 403 FORBIDDEN           GET /parts-bills "$VIEWER"

# Products: any signed-in user reads them, only product.write changes them.
check "create product"            200 - POST /products "$ADMIN" "{\"name\":\"part$S\",\"unit\":\"pc\"}"
PRODUCT_ID=$(jq -r .id <<<"$BODY")
check "duplicate product name"    409 DUPLICATE           POST /products "$ADMIN" "{\"name\":\"part$S\",\"unit\":\"pc\"}"
check "product without unit"      400 HTTP_400            POST /products "$ADMIN" "{\"name\":\"x$S\",\"unit\":\"\"}"
check "update product"            204 - PUT "/products/$PRODUCT_ID" "$ADMIN" "{\"name\":\"part$S\",\"unit\":\"set\"}"
check "viewer may read products"  200 - GET /products "$VIEWER"
jq -e --arg n "part$S" 'any(.[]; .name == $n and .unit == "set")' <<<"$BODY" >/dev/null || { echo "FAIL: product not listed"; exit 1; }
check "viewer may not add products" 403 FORBIDDEN         POST /products "$VIEWER" "{\"name\":\"v$S\",\"unit\":\"pc\"}"
check "delete product"            204 - DELETE "/products/$PRODUCT_ID" "$ADMIN"
check "deleted product is gone"   404 NOT_FOUND           DELETE "/products/$PRODUCT_ID" "$ADMIN"
check "add deleted product again" 200 - POST /products "$ADMIN" "{\"name\":\"part$S\",\"unit\":\"box\"}"
[ "$(jq -r .id <<<"$BODY")" = "$PRODUCT_ID" ] || { echo "FAIL: re-adding did not restore the same product"; exit 1; }

# Customers: same rules as products.
check "create customer"           200 - POST /names/customer "$ADMIN" "{\"name\":\"cust$S\"}"
CUSTOMER_ID=$(jq -r .id <<<"$BODY")
check "duplicate customer name"   409 DUPLICATE           POST /names/customer "$ADMIN" "{\"name\":\"cust$S\"}"
check "customer without name"     400 HTTP_400            POST /names/customer "$ADMIN" "{\"name\":\"\"}"
check "update customer"           204 - PUT "/names/customer/$CUSTOMER_ID" "$ADMIN" "{\"name\":\"cust$S-b\"}"
check "viewer may read customers" 200 - GET /names/customer "$VIEWER"
jq -e --arg n "cust$S-b" 'any(.[]; .name == $n)' <<<"$BODY" >/dev/null || { echo "FAIL: customer not listed"; exit 1; }
check "viewer may not add customers" 403 FORBIDDEN        POST /names/customer "$VIEWER" "{\"name\":\"v$S\"}"
check "delete customer"           204 - DELETE "/names/customer/$CUSTOMER_ID" "$ADMIN"
check "add deleted customer again" 200 - POST /names/customer "$ADMIN" "{\"name\":\"cust$S-b\"}"
[ "$(jq -r .id <<<"$BODY")" = "$CUSTOMER_ID" ] || { echo "FAIL: re-adding did not restore the same record"; exit 1; }

# A password change must end the sessions that used the old password.
check "change viewer password"    204 - PUT "/users/$USER_ID" "$ADMIN" "{\"displayName\":\"Viewer\",\"isActive\":true,\"roleIds\":[$ROLE],\"password\":\"Viewer@67890\"}"
check "old token after password change" 401 TOKEN_EXPIRED GET /users "$VIEWER"
check "old token, me"             401 TOKEN_EXPIRED       GET /auth/me "$VIEWER"
check "viewer login, new password" 200 - POST /auth/login "" "$(login_json "viewer$S" Viewer@67890)"
VIEWER=$(login_token)
# Disabling a user must take effect on the token they already hold.
check "disable viewer"            204 - PUT "/users/$USER_ID" "$ADMIN" "{\"displayName\":\"Viewer\",\"isActive\":false,\"roleIds\":[$ROLE]}"
check "disabled user, old token"  403 FORBIDDEN           GET /users "$VIEWER"
check "disabled user, products"   403 FORBIDDEN           GET /products "$VIEWER"
check "disabled user cannot log in" 401 INVALID_CREDENTIALS POST /auth/login "" "$(login_json "viewer$S" Viewer@67890)"

# Five wrong passwords lock the account, even against the right one; an administrator's password reset unlocks it.
check "create lock user"          200 - POST /users "$ADMIN" "{\"username\":\"lock$S\",$NEW_USER,\"roleIds\":[]}"
LOCK_ID=$(jq -r .id <<<"$BODY")
for i in 1 2 3 4 5; do check "wrong password $i"   401 INVALID_CREDENTIALS POST /auth/login "" "$(login_json "lock$S" wrong-password)"; done
check "locked: right password refused" 401 INVALID_CREDENTIALS POST /auth/login "" "$(login_json "lock$S" Viewer@12345)"
check "admin resets password"     204 - PUT "/users/$LOCK_ID" "$ADMIN" "{\"displayName\":\"V\",\"isActive\":true,\"roleIds\":[],\"password\":\"Viewer@67890\"}"
check "unlocked by the reset"     200 - POST /auth/login "" "$(login_json "lock$S" Viewer@67890)"

# Holding role.write or user.write gives out only the permissions you hold yourself.
check "create manager role"       200 - POST /roles "$ADMIN" "{\"name\":\"mgr$S\",\"permissions\":[\"user.read\",\"user.write\",\"role.read\",\"role.write\"]}"
MGR_ROLE=$(jq -r .id <<<"$BODY")
check "create manager"            200 - POST /users "$ADMIN" "{\"username\":\"mgr$S\",$NEW_USER,\"roleIds\":[$MGR_ROLE]}"
MGR_ID=$(jq -r .id <<<"$BODY")
check "manager login"             200 - POST /auth/login "" "$(login_json "mgr$S" Viewer@12345)"
MGR=$(login_token)
check "manager grants what they hold" 200 - POST /roles "$MGR" "{\"name\":\"sub$S\",\"permissions\":[\"user.read\"]}"
check "manager grants more"       403 PERMISSION_NOT_HELD POST /roles "$MGR" "{\"name\":\"big$S\",\"permissions\":[\"bill.read\"]}"
check "manager widens own role"   403 PERMISSION_NOT_HELD PUT "/roles/$MGR_ROLE" "$MGR" "{\"name\":\"mgr$S\",\"permissions\":[\"user.read\",\"user.write\",\"role.read\",\"role.write\",\"bill.read\"]}"
check "manager gives self admin"  403 PERMISSION_NOT_HELD PUT "/users/$MGR_ID" "$MGR" "{\"displayName\":\"V\",\"isActive\":true,\"roleIds\":[$MGR_ROLE,1]}"
check "manager creates an admin"  403 PERMISSION_NOT_HELD POST /users "$MGR" "{\"username\":\"adm$S\",$NEW_USER,\"roleIds\":[1]}"
check "admin's id"                200 - GET /auth/me "$ADMIN"
ADMIN_ID=$(jq -r .id <<<"$BODY")
check "manager resets admin password" 403 PERMISSION_NOT_HELD PUT "/users/$ADMIN_ID" "$MGR" "{\"displayName\":\"Administrator\",\"isActive\":true,\"roleIds\":[1],\"password\":\"Taken@12345\"}"

# Every user changes their own password; the old session ends, the new cookie works.
check "own password, wrong current" 400 WRONG_PASSWORD     POST /auth/password "$MGR" '{"currentPassword":"nope","newPassword":"Mgr@123456"}'
check "own password, too short"   400 HTTP_400            POST /auth/password "$MGR" '{"currentPassword":"Viewer@12345","newPassword":"123"}'
check "change own password"       204 - POST /auth/password "$MGR" '{"currentPassword":"Viewer@12345","newPassword":"Mgr@123456"}'
NEW_MGR=$(login_token)
check "old session ended"         401 TOKEN_EXPIRED       GET /auth/me "$MGR"
check "new cookie works"          200 - GET /auth/me "$NEW_MGR"
check "login with new password"   200 - POST /auth/login "" "$(login_json "mgr$S" Mgr@123456)"

# Signing out revokes that token only: a copy of it stops working, another session of the same user does not.
check "second manager session"    200 - POST /auth/login "" "$(login_json "mgr$S" Mgr@123456)"
OTHER_MGR=$(login_token)
check "logout revokes the token"  204 - POST /auth/logout "$NEW_MGR"
check "revoked token, me"         401 TOKEN_EXPIRED       GET /auth/me "$NEW_MGR"
check "revoked token, api"        401 TOKEN_EXPIRED       GET /users "$NEW_MGR"
check "logout twice"              204 - POST /auth/logout "$NEW_MGR"
check "other session still works" 200 - GET /auth/me "$OTHER_MGR"

# The audit log records who changed what; secrets never appear in it.
check "audit of the bill"         200 - GET "/audit?entity=PartsBill&entityId=$BILL_ID" "$ADMIN"
jq -e '.total >= 2 and any(.items[]; .action == "Added" and .user != null) and any(.items[]; .action == "Modified")' <<<"$BODY" >/dev/null || { echo "FAIL: bill audit: $BODY"; exit 1; }
check "audit of a password reset" 200 - GET "/audit?entity=User&entityId=$LOCK_ID" "$ADMIN"
grep -q 'AQAAAA' <<<"$BODY" && { echo "FAIL: password hash in the audit log"; exit 1; }
jq -e 'any(.items[]; .changes | contains("***"))' <<<"$BODY" >/dev/null || { echo "FAIL: password change not recorded: $BODY"; exit 1; }
check "manager may not read audit" 403 FORBIDDEN          GET /audit "$OTHER_MGR"

echo "ALL PASSED"
