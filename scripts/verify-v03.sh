#!/bin/bash
# 临时 dev server 验证脚本：启动 → curl 验证 → kill 干净
set -u
cd "$(dirname "$0")/.."
PORT=7319
LOG=/tmp/ff-dev-$PORT.log
PASS=0
FAIL=0

ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1"; }

npm run dev -- --port "$PORT" >"$LOG" 2>&1 &
DEV_PID=$!

cleanup() {
  kill "$DEV_PID" 2>/dev/null
  wait "$DEV_PID" 2>/dev/null
  # vite 可能留子进程，按端口清一遍
  PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
  [ -n "$PIDS" ] && kill $PIDS 2>/dev/null
  sleep 0.5
}
trap cleanup EXIT

# 等服务起来
for i in $(seq 1 40); do
  curl -sf "http://localhost:$PORT/api/state" >/dev/null 2>&1 && break
  sleep 0.5
done

BASE="http://localhost:$PORT"
TS=$(date +%s)
F1="/tmp/ff-curl-$TS-a.txt"
F2="/tmp/ff-curl-$TS-b.txt"
echo "hello frames $TS" >"$F1"
echo "hello free canvas $TS" >"$F2"

echo "== 1. 基线 /api/state =="
S=$(curl -sf "$BASE/api/state")
echo "$S" | grep -q '"nodes"' && ok "state 返回 graph.nodes" || bad "state 缺 nodes"

echo "== 2. 文件夹画布 /api/import 回归（含 path 字段）=="
R=$(curl -sf -F "files=@$F1" "$BASE/api/import")
echo "$R" | grep -q '"path"' && ok "dir 画布 import 200 且含绝对路径" || bad "dir 画布 import: $R"
P1=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['files'][0]['path'])" 2>/dev/null)

echo "== 3. 缩略图 / 文本预览回归 =="
curl -sf -o /dev/null "$BASE/api/thumb?name=cover-mockup.png" && ok "thumb 200" || bad "thumb 非 200"
curl -sf "$BASE/api/preview?name=README.md" | grep -q '"text"' && ok "preview 200" || bad "preview 非 200"

echo "== 4. 建自由画布 =="
R=$(curl -sf -X POST -H 'content-type: application/json' -d '{"name":"__curltest__"}' "$BASE/api/canvas")
CID=$(echo "$R" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['activeCanvas']['id'])" 2>/dev/null)
[ -n "$CID" ] && ok "自由画布已创建并激活: $CID" || bad "创建画布失败"

echo "== 5. 自由画布 /api/import（新语义）=="
R=$(curl -sf -F "files=@$F2" "$BASE/api/import")
echo "$R" | grep -q '"path"' && ok "自由画布 import 200 且含绝对路径" || bad "自由画布 import: $R"
P2=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['files'][0]['path'])" 2>/dev/null)
[ -f "$P2" ] && ok "文件确实写入受管文件夹: $P2" || bad "文件未写入: $P2"

echo "== 6. frames 往返持久化 =="
curl -sf -X POST -H 'content-type: application/json' \
  -d '{"nodes":[],"edges":[],"frames":[{"id":"fr:t1","name":"测试分组","x":10,"y":20,"w":300,"h":200}]}' \
  "$BASE/api/graph" >/dev/null
R=$(curl -sf "$BASE/api/state")
echo "$R" | grep -q '"测试分组"' && ok "frames 写入后可读回" || bad "frames 未持久化: $R"
# 坏数据清洗：负尺寸被丢弃
curl -sf -X POST -H 'content-type: application/json' \
  -d '{"nodes":[],"edges":[],"frames":[{"id":"fr:bad","name":"坏","x":0,"y":0,"w":-5,"h":200}]}' \
  "$BASE/api/graph" >/dev/null
R=$(curl -sf "$BASE/api/state")
echo "$R" | grep -q '"fr:bad"' && bad "非法 frame 未被清洗" || ok "非法 frame 被 sanitize 丢弃"

echo "== 7. 清理：删测试画布 + 测试文件 =="
curl -sf -X POST -H 'content-type: application/json' -d "{\"id\":\"$CID\"}" "$BASE/api/canvas/delete" >/dev/null && ok "测试画布已删" || bad "删画布失败"
[ -n "${P1:-}" ] && [ -f "$P1" ] && rm -f "$P1"
[ -n "${P2:-}" ] && [ -f "$P2" ] && rm -f "$P2"
rm -f "$F1" "$F2"

echo
echo "结果: $PASS 通过, $FAIL 失败"
exit $FAIL
