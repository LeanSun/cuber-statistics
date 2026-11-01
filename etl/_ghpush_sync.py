#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把本地 HEAD 的整棵树同步到 GitHub 远端 main（全量对账，幂等、安全）。

为什么不用 _ghpush_all.py：
本地仓库与远端 main 的「同一批提交」SHA 不同（远端提交由本脚本/Agent 经 API 重建成新对象，
父链不同 → commit SHA 不同），本地不存在与远端 tip 相同的 commit 对象，按 parent..HEAD 做增量
diff 会对不上。本脚本按 blob SHA 逐文件对账并「从零」重建整棵树：

  - 取远端当前 tip 作为新提交的 parent（保证 fast-forward）；
  - 取本地 HEAD 整棵树（git ls-tree -r）；
  - 对每个非排除文件：若其 blob SHA 已存在于远端（内容一致）→ 直接复用；否则上传本地 blob；
  - EXCLUDE（js/data.js, js/roster.js）始终用远端版本——它们是 CI 按最新 WCA 导出重建的，
    本地副本较旧，绝不能用本地覆盖，否则线上数据回退；
  - 用「无 base_tree」的方式一次性建整棵树，保证结果树 == 本地 HEAD 树（data/roster 取远端最新），
    彻底绕开「base_tree + 条目覆盖」在远端偶尔不生效的坑。

用法：python etl/_ghpush_sync.py [目标提交=HEAD]
"""
import base64, json, os, subprocess, sys, time, urllib.request

ROOT = r'E:/WorkBuddy/魔方10.18'
OWNER, REPO, BRANCH = 'LeanSun', 'cuber-statistics', 'main'

# CI 按最新 WCA 导出重建，本地副本较旧，推送时一律保留远端版本
EXCLUDE = {'js/data.js', 'js/roster.js'}


def sh(args):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True).stdout


def token():
    out = subprocess.run(['git', 'credential', 'fill'], cwd=ROOT,
                         input='protocol=https\nhost=github.com\n\n',
                         capture_output=True, text=True,
                         env=dict(os.environ, GCM_INTERACTIVE='never', GCM_GUI_PROMPT='false'))
    for line in out.stdout.splitlines():
        if line.startswith('password='):
            return line.split('=', 1)[1].strip()
    raise SystemExit('no token found')


TOK = token()


def api(method, path, body=None, timeout=600):
    url = 'https://api.github.com' + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Authorization', 'token ' + TOK)
    req.add_header('Accept', 'application/vnd.github+json')
    req.add_header('User-Agent', 'wb-push')
    if data:
        req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


target = sys.argv[1] if len(sys.argv) > 1 else 'HEAD'
message = (sh(['git', 'log', '-1', '--pretty=%B', target]).strip()
           or 'chore: sync local -> live (full tree)')

# 远端 base（新提交的 parent，保证 fast-forward）
ref = api('GET', '/repos/%s/%s/git/ref/heads/%s' % (OWNER, REPO, BRANCH))
base_sha = ref['object']['sha']
commit = api('GET', '/repos/%s/%s/git/commits/%s' % (OWNER, REPO, base_sha))
base_tree = commit['tree']['sha']
print('remote base %s tree %s' % (base_sha[:8], base_tree[:8]))

rtree = api('GET', '/repos/%s/%s/git/trees/%s?recursive=1' % (OWNER, REPO, base_tree))['tree']
remote_blob = {e['path']: e['sha'] for e in rtree if e['type'] == 'blob'}
remote_shas = set(remote_blob.values())

# 本地 HEAD 树
local_lines = sh(['git', '-c', 'core.quotePath=false', 'ls-tree', '-r', target]).strip().split('\n')

entries = []
uploaded = 0
reused = 0
kept = 0
for line in local_lines:
    if not line.strip():
        continue
    meta, path = line.split('\t', 1)
    mode, typ, sha = meta.split()
    if path in EXCLUDE:
        rsha = remote_blob.get(path)
        if not rsha:
            # 远端没有（极端情况）→ 上传本地兜底
            p = os.path.join(ROOT, path)
            raw = open(p, 'rb').read()
            blob = api('POST', '/repos/%s/%s/git/blobs' % (OWNER, REPO),
                       {'content': base64.b64encode(raw).decode(), 'encoding': 'base64'})
            rsha = blob['sha']
            print('  UPLOAD-FALLBACK', path)
        entries.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': rsha})
        print('  KEEP-REMOTE', path)
        kept += 1
        continue
    # 内容已在远端（任意路径）→ 直接复用；否则上传
    # 关键：从 git 对象读取「规范化」（LF）内容，而非磁盘原始字节（磁盘可能是 CRLF），
    # 否则上传的是 CRLF 副本，与 HEAD 的 LF blob 永远对不上，且会不断重复上传。
    if sha in remote_shas:
        reused += 1
    else:
        # 用 git cat-file 取规范化内容（与 HEAD 对象字节一致）
        raw = subprocess.run(['git', 'cat-file', 'blob', sha], cwd=ROOT,
                             capture_output=True).stdout
        if not raw:
            p = os.path.join(ROOT, path)
            if not os.path.exists(p):
                print('  SKIP(missing)', path)
                continue
            raw = open(p, 'rb').read()
        t0 = time.time()
        blob = api('POST', '/repos/%s/%s/git/blobs' % (OWNER, REPO),
                   {'content': base64.b64encode(raw).decode(), 'encoding': 'base64'})
        sha = blob['sha']
        uploaded += 1
        print('  UPLOAD %-50s %8.2f MB  %.1fs' % (path[:50], len(raw) / 1048576.0, time.time() - t0))
    entries.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': sha})

print('summary: uploaded=%d reused=%d kept_remote=%d total_entries=%d' % (uploaded, reused, kept, len(entries)))

# 关键：不加 base_tree，从零建整棵树，保证 == 本地 HEAD 树（data/roster 取远端最新）
tree = api('POST', '/repos/%s/%s/git/trees' % (OWNER, REPO), {'tree': entries})
new = api('POST', '/repos/%s/%s/git/commits' % (OWNER, REPO),
          {'message': message, 'tree': tree['sha'], 'parents': [base_sha]})
api('PATCH', '/repos/%s/%s/git/refs/heads/%s' % (OWNER, REPO, BRANCH),
    {'sha': new['sha'], 'force': False})
print('pushed %s -> %s  (parent was %s)' % (new['sha'][:8], BRANCH, base_sha[:8]))
