#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""通过 GitHub API 推送本地最新提交的全部变更（git https 走代理 502 时的备用通道）。

用法：python etl/_ghpush_all.py [父提交] —— 默认取 HEAD 的父提交做 diff。
对新增/修改文件逐个创建 blob，删除文件用 sha=null 的 tree 条目，
最后一次性建 tree → commit → 更新 ref。
"""
import base64, json, os, subprocess, sys, time, urllib.request

ROOT = r'E:/WorkBuddy/魔方10.18'
OWNER, REPO, BRANCH = 'LeanSun', 'cuber-statistics', 'main'


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


# 超大产物由仓库自带的 update-data.yml（GitHub Actions）重建并回推，
# 不经 API 传输（GitHub blob 接口对 60MB 级文件会直接拒绝）。
EXCLUDE = {'js/data.js', 'js/roster.js'}

parent = sys.argv[1] if len(sys.argv) > 1 else sh(['git', 'rev-parse', 'HEAD^']).strip()
message = sh(['git', 'log', '-1', '--pretty=%B', 'HEAD']).strip() or 'chore: sync'
status = sh(['git', '-c', 'core.quotePath=false', 'diff', '--name-status', '--find-renames=0', parent, 'HEAD']).strip().split('\n')

adds, dels = [], []
for line in status:
    if not line.strip():
        continue
    parts = line.split('\t')
    st = parts[0].strip()
    if st.startswith('R'):          # 重命名：旧删新加
        dels.append(parts[1])
        adds.append(parts[2])
    elif st == 'D':
        dels.append(parts[1])
    else:
        if parts[-1] in EXCLUDE:
            continue
        adds.append(parts[-1])

print('changed: +%d -%d' % (len(adds), len(dels)))

ref = api('GET', '/repos/%s/%s/git/ref/heads/%s' % (OWNER, REPO, BRANCH))
base_sha = ref['object']['sha']
commit = api('GET', '/repos/%s/%s/git/commits/%s' % (OWNER, REPO, base_sha))
tree_sha = commit['tree']['sha']
print('remote base %s tree %s' % (base_sha[:8], tree_sha[:8]))

entries = []
for f in sorted(dels):
    entries.append({'path': f, 'mode': '100644', 'type': 'blob', 'sha': None})
    print('  DEL', f)

# 大文件先传，避免小文件跑完后才暴露体积问题
adds.sort(key=lambda p: -os.path.getsize(os.path.join(ROOT, p)))

for f in adds:
    p = os.path.join(ROOT, f)
    if not os.path.exists(p):
        print('  SKIP (missing)', f)
        continue
    raw = open(p, 'rb').read()
    t0 = time.time()
    blob = api('POST', '/repos/%s/%s/git/blobs' % (OWNER, REPO),
               {'content': base64.b64encode(raw).decode(), 'encoding': 'base64'})
    entries.append({'path': f, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
    print('  ADD %-42s %8.1f MB  %.1fs' % (f, len(raw) / 1048576.0, time.time() - t0))

print('creating tree with %d entries' % len(entries))
tree = api('POST', '/repos/%s/%s/git/trees' % (OWNER, REPO),
           {'base_tree': tree_sha, 'tree': entries})
new = api('POST', '/repos/%s/%s/git/commits' % (OWNER, REPO),
          {'message': message, 'tree': tree['sha'], 'parents': [base_sha]})
api('PATCH', '/repos/%s/%s/git/refs/heads/%s' % (OWNER, REPO, BRANCH),
    {'sha': new['sha'], 'force': False})
print('pushed', new['sha'], '->', BRANCH)
