/* 通过 api.github.com 推送一次提交（git https 走代理 502 时的备用通道） */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OWNER = 'LeanSun', REPO = 'cuber-statistics', BRANCH = 'main';

function cred() {
  const out = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const m = out.match(/^password=(.*)$/m);
  if (!m) throw new Error('no credential');
  return m[1].trim();
}
const TOKEN = cred();

function api(method, url, body) {
  const args = ['-sS', '-X', method, '-H', 'Authorization: Bearer ' + TOKEN,
    '-H', 'Accept: application/vnd.github+json', '-H', 'User-Agent: gh-push',
    '-H', 'Content-Type: application/json', '--max-time', '120', url];
  if (body != null) args.push('--data-binary', JSON.stringify(body));
  const raw = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!raw) throw new Error('empty response from ' + url);
  const j = JSON.parse(raw);
  if (j && j.message && !j.sha && !j.object) throw new Error(url + ' -> ' + j.message);
  return j;
}

const BASE = 'https://api.github.com/repos/' + OWNER + '/' + REPO;
const ref = api('GET', BASE + '/git/ref/heads/' + BRANCH);
const baseCommit = ref.object.sha;
const commit = api('GET', BASE + '/git/commits/' + baseCommit);
const baseTree = commit.tree.sha;

const files = process.argv.slice(2);
const message = process.env.COMMIT_MSG || 'update';
const tree = [];
files.forEach(function (f) {
  const content = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const blob = api('POST', BASE + '/git/blobs', { content: content, encoding: 'utf-8' });
  tree.push({ path: f, mode: '100644', type: 'blob', sha: blob.sha });
  console.log('blob', f, blob.sha.slice(0, 8), content.length, 'chars');
});

const newTree = api('POST', BASE + '/git/trees', { base_tree: baseTree, tree: tree });
const newCommit = api('POST', BASE + '/git/commits', { message: message, tree: newTree.sha, parents: [baseCommit] });
api('PATCH', BASE + '/git/refs/heads/' + BRANCH, { sha: newCommit.sha });
console.log('pushed', newCommit.sha.slice(0, 8), '->', BRANCH);
