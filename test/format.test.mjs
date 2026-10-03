import { stripHashes, normalizeRefUrl, formatRefLine } from '/Users/hoshf/Project/dsh-md-export/src/render.js';

console.log('=== stripHashes：围栏感知 + 吸收内部加粗 ===');
const sample = [
  '# 一级标题',
  '## 2. **带粗体** 的二级标题',
  '正文里的 # 不是标题',
  '',
  '```sh',
  '# 这是 shell 注释，必须原样保留',
  'echo "# hi"',
  '```',
  '',
  '~~~python',
  '# 波浪围栏内也保留',
  '~~~',
  '',
  '#### 四级标题',
].join('\n');
console.log(stripHashes(sample));

console.log('\n=== normalizeRefUrl：去 hash / tracking / 尾斜杠 ===');
for (const u of [
  'https://a.com/x/?utm_source=tw&id=1#frag',
  'https://a.com/x/',
  'https://a.com/',
  'not a url###',
]) console.log(`  ${u}\n    → ${normalizeRefUrl(u)}`);

console.log('\n=== formatRefLine ===');
console.log('  ' + formatRefLine(1, 'Real Title', 'https://a.com/x'));
console.log('  ' + formatRefLine(2, '', 'https://a.com/y'));
console.log('  ' + formatRefLine(3, 'https://a.com/z', 'https://a.com/z'));
