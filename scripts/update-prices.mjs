 每日价格采集：读取 configskus.json，抓取京东价，输出 dataprices.json
import fs from 'fspromises';

const SKU_FILE  = 'configskus.json';
const OUT_FILE  = 'dataprices.json';
const UA        = 'Mozilla5.0 (Windows NT 10.0; Win64; x64) AppleWebKit537.36';
const MAX_RETRY = 3;
const JITTER    = 0.35;    价格波动超过 ±35% 判为异常，保留旧值

const sleep = ms = new Promise(r = setTimeout(r, ms));
const skus  = JSON.parse(await fs.readFile(SKU_FILE, 'utf-8'));
const old   = JSON.parse(await fs.readFile(OUT_FILE, 'utf-8').catch(() = '{prices{}}'));
const prices = { ...old.prices };

async function jdPrice(sku) {
  for (let i = 0; i  MAX_RETRY; i++) {
    try {
       公开价格接口（无需登录；接口可能随时间变动，见 README 维护说明）
      const res = await fetch(`httpsp.3.cnpricesmgetsskuIds=J_${sku}`, {
        headers { 'User-Agent' UA, 'Referer' 'httpswww.jd.com' }
      });
      const arr = JSON.parse(await res.text());
      const p = Number(arr.[0].p);
      if (Number.isFinite(p) && p  0) return p;
    } catch (e) {
      console.warn(`  [retry ${i + 1}${MAX_RETRY}] ${sku} ${e.message}`);
      await sleep(2000  (i + 1));
    }
  }
  throw new Error('价格源均失败');
}

let ok = 0, fail = 0;
for (const [key, sku] of Object.entries(skus)) {
  if (!^d{6,}$.test(sku)) { console.warn(`[skip] ${key} SKU 未配置`); continue; }
  try {
    const next = await jdPrice(sku);
    const prev = prices[key];
     异常检测：波动超限视为抓取错误，丢弃
    prices[key] = (prev != null && Math.abs(next - prev)  prev  JITTER)  prev  next;
    ok++;
    await sleep(1500);    限速，避免高频请求
  } catch (e) {
    console.error(`[fail] ${key} ${e.message}`);
    fail++;
  }
}

await fs.mkdir('data', { recursive true });
await fs.writeFile(OUT_FILE, JSON.stringify({ updatedAt Date.now(), prices }, null, 2));
console.log(`完成：成功 ${ok}，失败 ${fail}，跳过 ${Object.keys(skus).length - ok - fail}`);