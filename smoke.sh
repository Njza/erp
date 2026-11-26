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

# Parts bills: save, server-side total, unique number, history search, permissions.
BILL_NO="T$S"
BILL="{\"no\":\"$BILL_NO\",\"date\":\"2026-01-02\",\"customer\":\"smoke$S\",\"handler\":\"h$S\",\"installer\":\"i$S\",\"settle\":true,\"warranty\":false,\"rows\":[{\"name\":\"a\",\"unit\":\"\",\"qty\":2,\"qtyUnit\":\"x\",\"price\":1.5},{\"name\":\"note only\"}]}"
check "create bill"               200 - POST /parts-bills "$ADMIN" "$BILL"
BILL_ID=$(jq -r .id <<<"$BODY")
check "duplicate bill number"     409 DUPLICATE           POST /parts-bills "$ADMIN" "$BILL"
check "read bill"                 200 - GET "/parts-bills/$BILL_ID" "$ADMIN"
jq -e '.total == 3 and (.rows | length) == 2 and .date == "2026-01-02"' <<<"$BODY" >/dev/null || { echo "FAIL: bill content: $BODY"; exit 1; }
check "update bill"               204 - PUT "/parts-bills/$BILL_ID" "$ADMIN" "${BILL/\"qty\":2/\"qty\":4}"
check "search history"            200 - GET "/parts-bills?q=smoke$S" "$ADMIN"
jq -e '.total == 1 and .items[0].total == 6' <<<"$BODY" >/dev/null || { echo "FAIL: history: $BODY"; exit 1; }
check "handler suggestions"       200 - GET /parts-bills/handlers "$ADMIN"
jq -e --arg h "h$S" 'index($h) != null' <<<"$BODY" >/dev/null || { echo "FAIL: handler not suggested: $BODY"; exit 1; }
check "installer suggestions"     200 - GET /parts-bills/installers "$ADMIN"
jq -e --arg i "i$S" 'index($i) != null' <<<"$BODY" >/dev/null || { echo "FAIL: installer not suggested: $BODY"; exit 1; }
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

# Customers: same rules as products.
check "create customer"           200 - POST /customers "$ADMIN" "{\"name\":\"cust$S\"}"
CUSTOMER_ID=$(jq -r .id <<<"$BODY")
check "duplicate customer name"   409 DUPLICATE           POST /customers "$ADMIN" "{\"name\":\"cust$S\"}"
check "customer without name"     400 HTTP_400            POST /customers "$ADMIN" "{\"name\":\"\"}"
check "update customer"           204 - PUT "/customers/$CUSTOMER_ID" "$ADMIN" "{\"name\":\"cust$S-b\"}"
check "viewer may read customers" 200 - GET /customers "$VIEWER"
jq -e --arg n "cust$S-b" 'any(.[]; .name == $n)' <<<"$BODY" >/dev/null || { echo "FAIL: customer not listed"; exit 1; }
check "viewer may not add customers" 403 FORBIDDEN        POST /customers "$VIEWER" "{\"name\":\"v$S\"}"
check "delete customer"           204 - DELETE "/customers/$CUSTOMER_ID" "$ADMIN"

# Disabling a user must take effect on the token they already hold.
check "disable viewer"            204 - PUT "/users/$USER_ID" "$ADMIN" "{\"displayName\":\"Viewer\",\"isActive\":false,\"roleIds\":[$ROLE]}"
check "disabled user, old token"  403 FORBIDDEN           GET /users "$VIEWER"
check "disabled user, products"   403 FORBIDDEN           GET /products "$VIEWER"
check "disabled user cannot log in" 401 INVALID_CREDENTIALS POST /auth/login "" "$(login_json "viewer$S" Viewer@12345)"

echo "ALL PASSED"
