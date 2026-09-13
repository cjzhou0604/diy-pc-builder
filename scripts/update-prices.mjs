import fs from 'fs/promises';
import path from 'path';

const SKU_FILE = 'config/skus.json';
const OUT_FILE = 'data/prices.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// 安全读取并解析 JSON，失败则返回空对象
async function safeReadJSON(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (e) {
        console.warn(`[warn] 无法读取或解析 ${filePath}，将使用默认空数据。原因: ${e.message}`);
        return {};
    }
}

// 安全写入文件，确保目录存在
async function safeWriteFile(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
        console.log(`[ok] 成功写入 ${filePath}`);
    } catch (e) {
        console.error(`[fatal] 写入文件失败: ${filePath}`, e);
        process.exit(1); // 仅当磁盘写入失败时才视为致命错误
    }
}

// 带重试和严格校验的网络请求
async function fetchPriceWithRetry(sku, retries = 2) {
    const url = `https://p.3.cn/prices/mgets?skuIds=J_${sku}`;
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': UA, 'Referer': 'https://www.jd.com/' }
            });
            // 严格检查 HTTP 状态码
            if (!res.ok) throw new Error(`HTTP 状态码异常: ${res.status}`);
            
            const text = await res.text();
            const arr = JSON.parse(text); // 若返回 HTML 错误页，此处会抛出 SyntaxError 并被捕获
            const p = Number(arr?.[0]?.p);
            
            if (Number.isFinite(p) && p > 0) return p;
            throw new Error('返回了无效的价格数据');
        } catch (e) {
            if (i === retries - 1) throw e;
            await new Promise(r => setTimeout(r, 1500 * (i + 1)));
        }
    }
}

// 主控制流
async function main() {
    console.log('=== 开始价格更新任务 ===');
    
    const skus = await safeReadJSON(SKU_FILE);
    const oldData = await safeReadJSON(OUT_FILE);
    const oldPrices = oldData.prices || {};
    const newPrices = { ...oldPrices };

    let stats = { success: 0, fail: 0, skip: 0 };

    for (const [key, sku] of Object.entries(skus)) {
        if (!sku || typeof sku !== 'string' || !/^\d{6,}$/.test(sku)) {
            console.log(`[skip] ${key}: SKU 格式无效或占位符 (${sku})`);
            stats.skip++;
            continue;
        }

        try {
            console.log(`[fetch] 正在获取 ${key} (SKU: ${sku})...`);
            const nextPrice = await fetchPriceWithRetry(sku);
            const prevPrice = oldPrices[key];
            
            // 异常波动检测 (±35%)
            if (prevPrice != null && Math.abs(nextPrice - prevPrice) / prevPrice > 0.35) {
                console.warn(`[warn] ${key} 价格波动过大 (${prevPrice} -> ${nextPrice})，防作弊拦截，保留旧值。`);
            } else {
                newPrices[key] = nextPrice;
            }
            stats.success++;
            await new Promise(r => setTimeout(r, 1000)); // 请求限速
        } catch (e) {
            // 隔离单品失败，绝不中断整体流程
            console.error(`[fail] ${key} 获取失败: ${e.message}`);
            stats.fail++;
        }
    }

    console.log(`=== 采集统计: 成功 ${stats.success}, 失败 ${stats.fail}, 跳过 ${stats.skip} ===`);

    const outputData = {
        updatedAt: Date.now(),
        prices: newPrices
    };

    await safeWriteFile(OUT_FILE, outputData);
    console.log('=== 任务圆满结束 ===');
}

// 顶层兜底
main().catch(err => {
    console.error('[fatal] 未捕获的顶层异常:', err);
    process.exit(1);
});