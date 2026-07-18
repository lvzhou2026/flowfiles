#!/bin/bash
# FlowFiles 一次性验证脚本：启动 dev server → curl 验证 API → 停掉 server
set -u
cd /Users/lvzhou/Documents/kimi/workspace/flowfiles
PORT=7100

npm run dev -- --port $PORT --strictPort > /tmp/flowfiles-dev.log 2>&1 &
DEV_PID=$!
cleanup() {
  pkill -P "$DEV_PID" 2>/dev/null
  kill "$DEV_PID" 2>/dev/null
  pkill -f "flowfiles/node_modules/.bin/vite" 2>/dev/null
  wait "$DEV_PID" 2>/dev/null
}
trap cleanup EXIT

ready=0
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/api/state" > /tmp/ff-state.json 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" != "1" ]; then
  echo "FAIL: dev server 未就绪"
  tail -20 /tmp/flowfiles-dev.log
  exit 1
fi

echo "=== 1. GET /api/state（摘要） ==="
python3 - <<'EOF'
import json
s = json.load(open('/tmp/ff-state.json'))
print('dir:', s['dir'])
print('files:', [(f['name'], f['size']) for f in s['files']])
print('graph nodes:', [(n['id'], n['fileName'], n['placeholder'], n['x'], n['y']) for n in s['graph']['nodes']])
print('graph edges:', [(e['from'], '->', e['to'], e['relation'], e['note']) for e in s['graph']['edges']])
EOF

echo
echo "=== 2. POST /api/materialize 创建 __verify-test.md ==="
curl -s -X POST "http://localhost:$PORT/api/materialize" \
  -H 'content-type: application/json' -d '{"fileName":"__verify-test.md"}'
echo
echo "--- 重复创建应返回 409 ---"
curl -s -o /dev/null -w '%{http_code}\n' -X POST "http://localhost:$PORT/api/materialize" \
  -H 'content-type: application/json' -d '{"fileName":"__verify-test.md"}'
echo "--- 路径穿越应被拒绝（400） ---"
curl -s -X POST "http://localhost:$PORT/api/open" \
  -H 'content-type: application/json' -d '{"fileName":"../package.json"}'
echo
ls -la demo-folder/__verify-test.md
rm -f demo-folder/__verify-test.md
echo "测试文件已清理"

echo
echo "=== 3. POST /api/open 打开 idea-note.md ==="
curl -s -X POST "http://localhost:$PORT/api/open" \
  -H 'content-type: application/json' -d '{"fileName":"idea-note.md"}'
echo

echo
echo "=== 4. POST /api/graph 保存并回读 ==="
python3 - <<'EOF'
import json, urllib.request
s = json.load(open('/tmp/ff-state.json'))
g = s['graph']
# 模拟用户拖动：把 idea-note 节点挪个位置，并给 plan-v2 加一条备注
for n in g['nodes']:
    if n['id'] == 'file:idea-note.md':
        n['x'], n['y'] = 123, 456
    if n['id'] == 'file:plan-v2.md':
        n['notes'].append({'text': '验证备注：来自 /api/graph 写入测试', 'at': 1760000000000})
req = urllib.request.Request(
    'http://localhost:7100/api/graph',
    data=json.dumps(g).encode(),
    headers={'content-type': 'application/json'},
    method='POST',
)
print('save:', urllib.request.urlopen(req).read().decode())
back = json.load(urllib.request.urlopen('http://localhost:7100/api/state'))
for n in back['graph']['nodes']:
    if n['id'] == 'file:idea-note.md':
        print('readback idea-note pos:', n['x'], n['y'])
    if n['id'] == 'file:plan-v2.md':
        print('readback plan-v2 notes:', n['notes'])
EOF

echo
echo "=== 5. POST /api/dir 错误路径应返回 400 ==="
curl -s -X POST "http://localhost:$PORT/api/dir" \
  -H 'content-type: application/json' -d '{"dir":"/no/such/path-xyz"}'
echo

echo
echo "=== 6. 前端页面可访问 ==="
curl -s -o /dev/null -w 'index.html http_code=%{http_code}\n' "http://localhost:$PORT/"

# 恢复 /api/graph 写入测试对 graph.json 的改动（还原坐标与备注）
python3 - <<'EOF'
import json
p = 'server-data/graph.json'
data = json.load(open(p))
for key, g in data.items():
    for n in g['nodes']:
        if n['id'] == 'file:idea-note.md':
            n['x'], n['y'] = 60, 60
        if n['id'] == 'file:plan-v2.md':
            n['notes'] = [x for x in n['notes'] if x.get('text') != '验证备注：来自 /api/graph 写入测试']
json.dump(data, open(p, 'w'), ensure_ascii=False, indent=2)
print('graph.json 已还原为播种状态')
EOF

echo
echo "ALL CHECKS DONE"
