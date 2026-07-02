// ============================================================
// 1. CONSTANTS & CONFIGURATION
// ============================================================
// ============================================================
// 3. STATE (Single Source of Truth)
// ============================================================
const state = {
    categories: ["إطارات", "محركات", "اكسسوارات"],
    products: [],
    expenses: [],
    clients: [],
    suppliers: [],
    retailSales: [],
    invoices: [],
    itemTracks: [],
    partnerWithdrawals: [],
    exchanges: [],
    capitalRecords: [],
    adminLogs: [],
    safeTransactions: [],
    ledgerEntries: [],
    invoiceCount: 150,
    rates: { try: 0, syp: 0 },
    safes: { usd: 0, try: 0, syp: 0 },
    lastSyncTime: null,
    syncVersion: 0,
};

// ============================================================
// 4. UTILITY FUNCTIONS
// ============================================================
function generateUniqueID() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (window.crypto && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0,4).join('')}-${hex.slice(4,6).join('')}-${hex.slice(6,8).join('')}-${hex.slice(8,10).join('')}-${hex.slice(10,16).join('')}`;
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

function forceArray(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data.filter(item => item !== null && item !== undefined);
    return Object.values(data).filter(item => item !== null && item !== undefined);
}

function currencyCode(value, fallback = 'usd') {
    const v = String(value || fallback || 'usd').trim().toLowerCase();
    if (v === 'try' || v === 'tl' || v === '₺') return 'try';
    if (v === 'syp' || v === 'sp' || v === 'ل.س') return 'syp';
    if (v === 'usd' || v === '$') return 'usd';
    return fallback;
}

function currencyLabel(value, fallback = 'USD') {
    const code = currencyCode(value, String(fallback || 'usd').toLowerCase());
    return code.toUpperCase();
}

function normalizeExchangeRecord(ex) {
    if (!ex || typeof ex !== 'object') return null;
    const fromCurr = currencyCode(ex.fromCurr || ex.fromCurrency || ex.from || ex.currencyFrom || 'usd');
    const toCurr = currencyCode(ex.toCurr || ex.toCurrency || ex.to || ex.currencyTo || 'usd');
    const fromAmount = Number(ex.fromAmount ?? ex.amountFrom ?? ex.amount ?? 0) || 0;
    const toAmount = Number(ex.toAmount ?? ex.amountTo ?? ex.receivedAmount ?? 0) || 0;
    return {
        ...ex,
        id: ex.id || generateUniqueID(),
        fromCurr,
        toCurr,
        fromAmount,
        toAmount,
        date: ex.date || ex.createdAt || ex.timestamp || new Date().toLocaleString('ar-EG'),
        _updatedAt: Number(ex._updatedAt || ex.timestamp || Date.now())
    };
}

function normalizeStateForLegacyData() {
    state.exchanges = forceArray(state.exchanges).map(normalizeExchangeRecord).filter(Boolean);
    state.safeTransactions = forceArray(state.safeTransactions).map(t => ({
        ...t,
        id: t && t.id ? t.id : generateUniqueID(),
        currency: currencyCode(t && t.currency, 'usd'),
        amount: Number(t && t.amount) || 0,
        date: t && t.date ? t.date : new Date().toLocaleString('ar-EG')
    }));
    state.expenses = forceArray(state.expenses).map(e => ({ ...e, id: e && e.id ? e.id : generateUniqueID(), currency: currencyCode(e && e.currency, 'usd') }));
    state.partnerWithdrawals = forceArray(state.partnerWithdrawals).map(w => ({ ...w, id: w && w.id ? w.id : generateUniqueID(), currency: currencyCode(w && w.currency, 'usd') }));
    state.capitalRecords = forceArray(state.capitalRecords).map(c => ({ ...c, id: c && c.id ? c.id : generateUniqueID(), currency: currencyCode(c && c.currency, 'usd') }));
    state.rates = { try: Number(state.rates && state.rates.try) || 0, syp: Number(state.rates && state.rates.syp) || 0 };
    state.safes = { usd: Number(state.safes && state.safes.usd) || 0, try: Number(state.safes && state.safes.try) || 0, syp: Number(state.safes && state.safes.syp) || 0 };
}

function safeUI(name, fn) {
    try { fn(); } catch (error) { console.error('UI update failed:', name, error); }
}

function currencySymbol(value) {
    const code = currencyCode(value, 'usd');
    if (code === 'try') return '₺';
    if (code === 'syp') return 'ل.س';
    return '$';
}

function formatCurrencyAmount(amount, currency, sign = '') {
    const code = currencyCode(currency, 'usd');
    return `${sign}${formatPrice(amount, code)}`;
}

function formatPrice(value, currency = 'usd') {
    const code = currencyCode(currency, 'usd');
    const n = Number(value);
    const safe = Number.isFinite(n) ? n : 0;
    const decimals = code === 'usd' ? 2 : 0;
    return `${safe.toFixed(decimals)} ${currencySymbol(code)}`;
}

function formatUsdEquivalent(value) {
    const n = Number.isFinite(Number(value)) ? Number(value) : 0;
    return `يعادل $${n.toFixed(2)}`;
}

function syncAfterLocalMutation() {
    saveToLocal();
    if (navigator.onLine) {
        SyncManager.performDeltaSync();
    }
}

function mergeById(localArr, cloudArr) {
    const local = Array.isArray(localArr) ? localArr : [];
    const cloud = Array.isArray(cloudArr) ? cloudArr : [];
    const allHaveIds = [...local, ...cloud].every(x => !x || x.id);
    if (!allHaveIds) {
        return cloud.length ? cloud : local;
    }
    const map = new Map();
    local.forEach(x => { if (x && x.id) map.set(x.id, x); });
    cloud.forEach(x => { if (x && x.id) map.set(x.id, { ...(map.get(x.id) || {}), ...x }); });
    return Array.from(map.values());
}

const PRODUCT_IDENTITY_FIELDS = ['code', 'barcode', 'partNumber', 'part_number', 'sku'];
const PRODUCT_NUMERIC_FIELDS = ['cost', 'wholesale', 'retail', 'stock'];
const PRODUCT_MAINTENANCE_VERSION = 'PRODUCTS_DEDUPE_V1';
const MASTER_PRODUCTS_EXPECTED_COUNT = 1303;
const MASTER_PRODUCTS_EXPECTED_SOURCE = 'ملف المنتجات.xlsx';
const MASTER_PRODUCTS_SHEET_NAME = 'المخزون';
const MASTER_PRODUCTS_CONFIRM_PHRASE = 'استبدال المنتجات من الملف';

function normalizeProductText(value) {
    const digitMap = {
        '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
        '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9'
    };
    return String(value ?? '')
        .normalize('NFKC')
        .replace(/[٠-٩۰-۹]/g, ch => digitMap[ch] || ch)
        .toLowerCase()
        .replace(/[^\w\u0600-\u06FF\s]+/g, ' ')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeProductCode(value) {
    return normalizeProductText(value).replace(/\s+/g, '');
}

function stableHash(value) {
    const text = String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function roundMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
}

function normalizeLegacyNumber(value, integer = false) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    const normalized = integer ? Math.trunc(n) : roundMoney(n);
    return normalized < 0 ? 0 : normalized;
}

function normalizeMasterNumberText(value) {
    const digitMap = {
        '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
        '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9'
    };
    let text = String(value ?? '')
        .normalize('NFKC')
        .replace(/[٠-٩۰-۹]/g, ch => digitMap[ch] || ch)
        .replace(/\s+/g, '')
        .replace(/[^\d.,+-]/g, '');
    if (text.includes(',') && text.includes('.')) {
        text = text.replace(/,/g, '');
    } else if (text.includes(',') && !text.includes('.')) {
        text = text.replace(',', '.');
    }
    return text;
}

function parseMasterNumberCell(value, options = {}) {
    const raw = String(value ?? '').trim();
    if (!raw) return { ok: false, empty: true, value: null };
    const normalized = normalizeMasterNumberText(value);
    if (!normalized || normalized === '+' || normalized === '-' || normalized === '.' || normalized === ',') {
        return { ok: false, empty: false, value: null };
    }
    const n = Number(normalized);
    if (!Number.isFinite(n) || n < 0) return { ok: false, empty: false, value: null };
    return { ok: true, empty: false, value: options.integer ? Math.trunc(n) : roundMoney(n) };
}

function createMasterProductId(name, category) {
    const normalizedName = normalizeProductText(name);
    const normalizedCategory = normalizeProductText(category);
    return `master-product-${stableHash(`${normalizedName}::${normalizedCategory}`)}`;
}

function getProductIdentityKeys(product) {
    if (!product || typeof product !== 'object') return [];
    const keys = [];
    PRODUCT_IDENTITY_FIELDS.forEach(field => {
        const normalized = normalizeProductCode(product[field]);
        if (normalized) keys.push(`${field}:${normalized}`);
    });
    if (product.id) keys.push(`id:${String(product.id)}`);
    return Array.from(new Set(keys));
}

function getProductSuspectedKeys(product) {
    if (!product || typeof product !== 'object') return [];
    const name = normalizeProductText(product.name);
    const category = normalizeProductText(product.category);
    if (!name || !category) return [];
    return [`exact-name-category-prices:${name}|${category}|${roundMoney(product.retail)}|${roundMoney(product.wholesale)}|${roundMoney(product.cost)}`];
}

function hasStrongProductIdentity(product) {
    if (!product || typeof product !== 'object') return false;
    return PRODUCT_IDENTITY_FIELDS.some(field => Boolean(normalizeProductCode(product[field])));
}

function createStableProductId(product, index = 0) {
    if (product && product.id) return String(product.id);
    const keys = getProductIdentityKeys(product).filter(key => !key.startsWith('id:'));
    const basis = keys[0] || JSON.stringify([
        normalizeProductText(product && product.name),
        normalizeProductText(product && product.category),
        roundMoney(product && product.cost),
        roundMoney(product && product.wholesale),
        roundMoney(product && product.retail),
        normalizeLegacyNumber(product && product.stock, true),
        index
    ]);
    return `prod_${stableHash(basis)}`;
}

function normalizeProductRecord(product, index = 0, fallbackId = '') {
    if (!product || typeof product !== 'object') return null;
    const normalized = { ...product };
    const hasIdentity = Boolean(normalized.id || normalized.name || normalized.code || normalized.barcode || normalized.partNumber || normalized.sku);
    if (!hasIdentity) return null;

    normalized.id = String(normalized.id || fallbackId || createStableProductId(normalized, index));
    PRODUCT_NUMERIC_FIELDS.forEach(field => {
        normalized[field] = normalizeLegacyNumber(normalized[field], field === 'stock');
    });
    normalized.version = Math.max(1, normalizeLegacyNumber(normalized.version, true) || 1);
    normalized._updatedAt = Number.isFinite(Number(normalized._updatedAt || normalized.timestamp))
        ? Number(normalized._updatedAt || normalized.timestamp)
        : 0;
    if (!normalized.category) normalized.category = state.categories && state.categories[0] ? state.categories[0] : 'General';
    normalized.__hadProductId = Boolean(product.id || fallbackId);
    return normalized;
}

function productCompletenessScore(product) {
    if (!product) return 0;
    let score = 0;
    ['name', 'category', 'cost', 'wholesale', 'retail', 'stock', 'image', 'code', 'barcode', 'partNumber', 'sku'].forEach(field => {
        const value = product[field];
        if (value !== undefined && value !== null && String(value).trim() !== '') score++;
    });
    if (product.image && !product.imageUploadPending) score += 3;
    if (product.__hadProductId) score += 2;
    return score;
}

function chooseBestProductVersion(a, b) {
    if (!a) return b;
    if (!b) return a;
    const checks = [
        [Number(a._updatedAt) || 0, Number(b._updatedAt) || 0],
        [Number(a.version) || 0, Number(b.version) || 0],
        [a.image && !a.imageUploadPending ? 1 : 0, b.image && !b.imageUploadPending ? 1 : 0],
        [productCompletenessScore(a), productCompletenessScore(b)]
    ];
    for (const [av, bv] of checks) {
        if (av !== bv) return av > bv ? a : b;
    }
    return a.__hadProductId && !b.__hadProductId ? a : b;
}

function mergeProductRecords(best, duplicate) {
    const merged = { ...best };
    Object.keys(duplicate || {}).forEach(key => {
        if (key.startsWith('__')) return;
        const current = merged[key];
        const incoming = duplicate[key];
        const currentMissing = current === undefined || current === null || String(current).trim() === '';
        const incomingPresent = incoming !== undefined && incoming !== null && String(incoming).trim() !== '';
        if (currentMissing && incomingPresent) merged[key] = incoming;
    });
    PRODUCT_NUMERIC_FIELDS.forEach(field => {
        merged[field] = normalizeLegacyNumber(best[field], field === 'stock');
    });
    merged.version = Math.max(Number(best.version) || 1, Number(duplicate && duplicate.version) || 1);
    merged._updatedAt = Math.max(Number(best._updatedAt) || 0, Number(duplicate && duplicate._updatedAt) || 0);
    merged.id = best.id || duplicate.id || createStableProductId(merged);
    merged.__hadProductId = Boolean(best.__hadProductId || duplicate.__hadProductId);
    return merged;
}

function finalizeProductRecord(product) {
    const clean = { ...product };
    delete clean.__hadProductId;
    PRODUCT_NUMERIC_FIELDS.forEach(field => {
        clean[field] = normalizeLegacyNumber(clean[field], field === 'stock');
    });
    clean.version = Math.max(1, normalizeLegacyNumber(clean.version, true) || 1);
    clean._updatedAt = Number.isFinite(Number(clean._updatedAt)) ? Number(clean._updatedAt) : Date.now();
    clean.id = String(clean.id || createStableProductId(clean));
    return clean;
}

function dedupeProductsSafe(products, options = {}) {
    const source = options.source || 'unknown';
    const input = forceArray(products);
    const groups = new Map();
    const identityMap = new Map();
    let groupSeq = 0;

    function mergeGroups(targetId, sourceId) {
        if (targetId === sourceId || !groups.has(targetId) || !groups.has(sourceId)) return targetId;
        const target = groups.get(targetId);
        const sourceGroup = groups.get(sourceId);
        sourceGroup.items.forEach(item => target.items.push(item));
        sourceGroup.keys.forEach(key => {
            target.keys.add(key);
            identityMap.set(key, targetId);
        });
        sourceGroup.matchTypes.forEach(type => target.matchTypes.add(type));
        const best = chooseBestProductVersion(target.best, sourceGroup.best);
        const duplicate = best === target.best ? sourceGroup.best : target.best;
        target.best = mergeProductRecords(best, duplicate);
        groups.delete(sourceId);
        return targetId;
    }

    input.forEach((raw, index) => {
        const product = normalizeProductRecord(raw, index);
        if (!product) return;
        const keys = getProductIdentityKeys(product);
        if (!keys.length) keys.push(`id:${product.id}`);
        const matched = Array.from(new Set(keys.map(key => identityMap.get(key)).filter(Boolean)));
        let groupId = matched[0];
        if (!groupId) {
            groupId = `g${++groupSeq}`;
            groups.set(groupId, { keys: new Set(), items: [], best: null, matchTypes: new Set() });
        } else if (matched.length > 1) {
            matched.slice(1).forEach(id => { groupId = mergeGroups(groupId, id); });
        }

        const group = groups.get(groupId);
        keys.forEach(key => {
            group.keys.add(key);
            identityMap.set(key, groupId);
            group.matchTypes.add(key.split(':')[0] || 'id');
        });
        group.items.push(product);
        const best = chooseBestProductVersion(group.best, product);
        const duplicate = best === group.best ? product : group.best;
        group.best = duplicate ? mergeProductRecords(best, duplicate) : best;
    });

    const confirmedGroups = [];
    const productsOut = [];
    groups.forEach(group => {
        const best = finalizeProductRecord(group.best);
        productsOut.push(best);
        if (group.items.length > 1) {
            confirmedGroups.push({
                key: Array.from(group.keys)[0] || best.id,
                matchTypes: Array.from(group.matchTypes),
                kept: { id: best.id, name: best.name || '' },
                removed: group.items
                    .filter(item => String(item.id) !== String(best.id) || item !== group.best)
                    .slice(0, 6)
                    .map(item => ({ id: item.id, name: item.name || '' })),
                count: group.items.length
            });
        }
    });

    const suspectedMap = new Map();
    productsOut.forEach(product => {
        if (hasStrongProductIdentity(product)) return;
        getProductSuspectedKeys(product).forEach(key => {
            if (!suspectedMap.has(key)) suspectedMap.set(key, []);
            suspectedMap.get(key).push(product);
        });
    });

    const suspectedGroups = Array.from(suspectedMap.entries())
        .filter(([, items]) => items.length > 1)
        .map(([key, items]) => ({
            key,
            matchTypes: ['exact-name-category-prices'],
            count: items.length,
            potentialDuplicates: items.length - 1,
            items: items.slice(0, 6).map(item => ({
                id: item.id,
                name: item.name || '',
                category: item.category || '',
                cost: item.cost,
                wholesale: item.wholesale,
                retail: item.retail
            }))
        }));

    const confirmedRemoved = Math.max(0, input.length - productsOut.length);
    const suspectedPotential = suspectedGroups.reduce((sum, group) => sum + group.potentialDuplicates, 0);
    productsOut.sort((a, b) => (Number(b._updatedAt) || 0) - (Number(a._updatedAt) || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'ar'));
    const report = {
        source,
        products: productsOut,
        totalBefore: input.length,
        totalAfter: productsOut.length,
        duplicateGroups: confirmedGroups.length + suspectedGroups.length,
        removedDuplicates: confirmedRemoved,
        confirmedDuplicates: {
            groups: confirmedGroups.length,
            removedDuplicates: confirmedRemoved,
            examples: confirmedGroups.slice(0, 20)
        },
        suspectedDuplicates: {
            groups: suspectedGroups.length,
            potentialDuplicates: suspectedPotential,
            examples: suspectedGroups.slice(0, 20)
        },
        examples: {
            confirmed: confirmedGroups.slice(0, 20),
            suspected: suspectedGroups.slice(0, 20)
        }
    };
    if (report.removedDuplicates && options.log !== false) console.warn('Product dedupe report:', report);
    return report;
}

function replaceProductsFromSource(products, source = 'unknown') {
    const report = dedupeProductsSafe(products, { source });
    state.products = report.products;
    return report;
}

function findProductIndexByIdentity(product, fallbackId = '') {
    const incoming = normalizeProductRecord(product, 0, fallbackId);
    if (!incoming) return -1;
    const incomingKeys = new Set(getProductIdentityKeys(incoming));
    return state.products.findIndex(existing => {
        if (!existing) return false;
        if (incoming.id && String(existing.id) === String(incoming.id)) return true;
        return getProductIdentityKeys(existing).some(key => incomingKeys.has(key));
    });
}

function cleanProductsData(productsList) {
    return dedupeProductsSafe(productsList, { source: 'cleanProductsData' }).products;
}

// ============================================================
// 6. LOCAL STORAGE
// ============================================================
localforage.config({ name: 'ABONIBALProductionData', storeName: 'pos_database_v1' });

const STORAGE_KEYS = {
    PRODUCTS: 'products',
    CLIENTS: 'clients',
    INVOICES: 'invoices',
    RETAIL_SALES: 'retailSales',
    EXPENSES: 'expenses',
    ITEM_TRACKS: 'itemTracks',
    SAFE_TRANSACTIONS: 'safeTransactions',
    LEDGER_ENTRIES: 'ledgerEntries',
    OTHER_DATA: 'otherData',
    SYNC_VERSION: 'syncVersion',
    LAST_SYNC_TIME: 'lastSyncTime',
};

async function saveToLocal() {
    try {
        const otherData = {
            categories: state.categories,
            suppliers: state.suppliers,
            rates: state.rates,
            safes: state.safes,
            exchanges: state.exchanges,
            partnerWithdrawals: state.partnerWithdrawals,
            capitalRecords: state.capitalRecords,
            invoiceCount: state.invoiceCount,
            adminLogs: state.adminLogs,
        };

        await Promise.all([
            localforage.setItem(STORAGE_KEYS.PRODUCTS, state.products),
            localforage.setItem(STORAGE_KEYS.CLIENTS, state.clients),
            localforage.setItem(STORAGE_KEYS.INVOICES, state.invoices),
            localforage.setItem(STORAGE_KEYS.RETAIL_SALES, state.retailSales),
            localforage.setItem(STORAGE_KEYS.EXPENSES, state.expenses),
            localforage.setItem(STORAGE_KEYS.ITEM_TRACKS, state.itemTracks),
            localforage.setItem(STORAGE_KEYS.SAFE_TRANSACTIONS, state.safeTransactions),
            localforage.setItem(STORAGE_KEYS.LEDGER_ENTRIES, state.ledgerEntries),
            localforage.setItem(STORAGE_KEYS.OTHER_DATA, otherData),
            localforage.setItem(STORAGE_KEYS.SYNC_VERSION, state.syncVersion),
            localforage.setItem(STORAGE_KEYS.LAST_SYNC_TIME, state.lastSyncTime),
        ]);

        updateSyncStatus('🔄 متزامن');
        return true;
    } catch (error) {
        console.error('Save to local failed:', error);
        return false;
    }
}

async function loadFromLocal() {
    try {
        const products = await localforage.getItem(STORAGE_KEYS.PRODUCTS) || [];
        const clients = await localforage.getItem(STORAGE_KEYS.CLIENTS) || [];
        const invoices = await localforage.getItem(STORAGE_KEYS.INVOICES) || [];
        const retailSales = await localforage.getItem(STORAGE_KEYS.RETAIL_SALES) || [];
        const expenses = await localforage.getItem(STORAGE_KEYS.EXPENSES) || [];
        const itemTracks = await localforage.getItem(STORAGE_KEYS.ITEM_TRACKS) || [];
        const safeTransactions = await localforage.getItem(STORAGE_KEYS.SAFE_TRANSACTIONS) || [];
        const ledgerEntries = await localforage.getItem(STORAGE_KEYS.LEDGER_ENTRIES) || [];
        const other = await localforage.getItem(STORAGE_KEYS.OTHER_DATA) || {};
        const syncVersion = await localforage.getItem(STORAGE_KEYS.SYNC_VERSION) || 0;
        const lastSyncTime = await localforage.getItem(STORAGE_KEYS.LAST_SYNC_TIME) || null;

        replaceProductsFromSource(products, 'loadFromLocal');
        state.clients = clients;
        state.invoices = invoices;
        state.retailSales = retailSales;
        state.expenses = expenses;
        state.itemTracks = itemTracks;
        state.safeTransactions = safeTransactions;
        state.ledgerEntries = ledgerEntries;
        state.syncVersion = syncVersion;
        state.lastSyncTime = lastSyncTime;
        state.categories = other.categories || ["إطارات", "محركات", "اكسسوارات"];
        state.suppliers = other.suppliers || [];
        state.rates = other.rates || { try: 0, syp: 0 };
        state.safes = other.safes || { usd: 0, try: 0, syp: 0 };
        state.exchanges = other.exchanges || [];
        state.partnerWithdrawals = other.partnerWithdrawals || [];
        state.capitalRecords = other.capitalRecords || [];
        state.invoiceCount = other.invoiceCount || 150;
        state.adminLogs = other.adminLogs || [];
        normalizeStateForLegacyData();

        return true;
    } catch (error) {
        console.error('Load from local failed:', error);
        return false;
    }
}


// ============================================================
// 6.1 FIREBASE ACCESS GATE
// ============================================================
async function ensureFirebaseAccess() {
    try {
        if (!window.firebase || !firebase.auth) {
            return { ok: false, error: 'Firebase Auth SDK غير محمل.' };
        }
        const auth = firebase.auth();
        const user = auth.currentUser;
        if (!user || !user.uid) {
            return { ok: false, error: 'يجب تسجيل الدخول إلى Firebase Auth قبل المزامنة.' };
        }
        return { ok: true, uid: user.uid, accountId: user.uid, email: user.email || '' };
    } catch (error) {
        return { ok: false, error: error && error.message ? error.message : String(error) };
    }
}

function isFirebasePermissionError(error) {
    const msg = String((error && (error.code || error.message)) || error || '').toLowerCase();
    return msg.includes('permission_denied') || msg.includes('permission denied') || msg.includes('permission-denied');
}

function explainFirebasePermissionError(error) {
    if (!isFirebasePermissionError(error)) return error && error.message ? error.message : String(error);
    return 'رفضت Firebase الوصول إلى قاعدة البيانات. عند تشغيل التطبيق كملف محلي content:// يجب أن تسمح Rules بالقراءة والكتابة لهذا التطبيق، أو استضافته على HTTPS ثم استخدام Auth.';
}

// ============================================================
// 7. DELTA SYNC SYSTEM (Production-safe queue + conflict handling)
// ============================================================
const SYNC_DEVICE_ID_KEY = 'abonibalProductionDeviceId';
const SYNC_QUEUE_KEY = 'abonibalProductionSyncQueueV2';
const SYNC_PENDING_IMAGES_KEY = 'abonibalProductionPendingImageUploads';
const PRODUCTS_REPLACEMENT_MARKER_KEY = 'abonibalProductsReplacementMarkerV1';
const DEVICE_ID = (() => {
    let id = localStorage.getItem(SYNC_DEVICE_ID_KEY);
    if (!id) {
        id = generateUniqueID();
        localStorage.setItem(SYNC_DEVICE_ID_KEY, id);
    }
    return id;
})();

function safeJsonParse(value, fallback) {
    try { return JSON.parse(value || ''); } catch (_) { return fallback; }
}

let productsReplacementMarkerLastRefresh = 0;

function readProductsReplacementMarker() {
    return safeJsonParse(localStorage.getItem(PRODUCTS_REPLACEMENT_MARKER_KEY), {});
}

function writeProductsReplacementMarker(marker) {
    const current = readProductsReplacementMarker();
    const next = {
        productsReplacedAt: Math.max(Number(current.productsReplacedAt) || 0, Number(marker && marker.productsReplacedAt) || 0),
        productsResetGeneration: Math.max(Number(current.productsResetGeneration) || 0, Number(marker && marker.productsResetGeneration) || 0),
        productsMasterImportCount: Number(marker && marker.productsMasterImportCount) || Number(current.productsMasterImportCount) || 0,
        productsMasterImportSource: marker && marker.productsMasterImportSource || current.productsMasterImportSource || ''
    };
    localStorage.setItem(PRODUCTS_REPLACEMENT_MARKER_KEY, JSON.stringify(next));
    return next;
}

function productReplacementCutoff() {
    const marker = readProductsReplacementMarker();
    return Math.max(Number(marker.productsReplacedAt) || 0, Number(marker.productsResetGeneration) || 0);
}

function syncChangeTimestamp(change) {
    return Math.max(
        Number(change && change.timestamp) || 0,
        Number(change && change.localSeq) || 0,
        Number(change && change.data && change.data._updatedAt) || 0
    );
}

function isStaleProductSyncChange(change) {
    if (!change || change.collection !== 'products') return false;
    const cutoff = productReplacementCutoff();
    if (!cutoff) return false;
    const changeTime = syncChangeTimestamp(change);
    return Boolean(changeTime && changeTime <= cutoff);
}

function activeProductSyncChanges(changes) {
    return forceArray(changes).filter(change => !isStaleProductSyncChange(change));
}

function pruneStaleProductSyncQueue() {
    if (typeof SyncQueue === 'undefined' || !Array.isArray(SyncQueue.items)) return 0;
    const before = SyncQueue.items.length;
    SyncQueue.items = SyncQueue.items.filter(change => !isStaleProductSyncChange(change));
    if (SyncQueue.items.length !== before) {
        try { SyncQueue.save(); } catch (error) { console.warn('Failed to save pruned stale product queue:', error); }
    }
    return before - SyncQueue.items.length;
}

async function refreshProductsReplacementMarkerFromFirebase(force = false) {
    const now = Date.now();
    if (!force && productsReplacementMarkerLastRefresh && now - productsReplacementMarkerLastRefresh < 30000) {
        return readProductsReplacementMarker();
    }
    productsReplacementMarkerLastRefresh = now;
    try {
        if (!navigator.onLine || typeof db === 'undefined' || !db || !db.ref) return readProductsReplacementMarker();
        const access = await ensureFirebaseAccess();
        if (!access.ok) return readProductsReplacementMarker();
        const snapshot = await db.ref('maintenance').once('value');
        const maintenance = snapshot.val() || {};
        const marker = writeProductsReplacementMarker({
            productsReplacedAt: maintenance.productsReplacedAt,
            productsResetGeneration: maintenance.productsResetGeneration,
            productsMasterImportCount: maintenance.productsMasterImportCount,
            productsMasterImportSource: maintenance.productsMasterImportSource
        });
        pruneStaleProductSyncQueue();
        return marker;
    } catch (error) {
        console.warn('Failed to refresh products replacement marker:', error);
        return readProductsReplacementMarker();
    }
}

const SyncQueue = {
    items: safeJsonParse(localStorage.getItem(SYNC_QUEUE_KEY), []),
    processed: new Set(),
    appendOnlyCollections: new Set([
        'retailSales', 'invoices', 'expenses', 'exchanges', 'partnerWithdrawals', 'capitalRecords',
        'itemTracks', 'safeTransactions', 'ledgerEntries', 'adminLogs'
    ]),
    save() {
        localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(this.items));
        // keep backward compatibility for devices that still read the old key
        localStorage.setItem('abonibalProductionSyncQueueLegacy', JSON.stringify(this.items));
    },
    getPending() {
        return this.items.filter(change => !change.synced);
    },
    add(change) {
        this.items.push(change);
        this.trim();
        this.save();
    },
    trim() {
        if (this.items.length > 3000) {
            const unsynced = this.items.filter(c => !c.synced);
            const syncedTail = this.items.filter(c => c.synced).slice(-500);
            this.items = syncedTail.concat(unsynced).slice(-3000);
        }
    },
    markSyncedByIds(ids) {
        const idSet = new Set(ids);
        this.items.forEach(change => {
            if (idSet.has(change.id)) change.synced = true;
        });
        this.save();
    },
    removeSynced() {
        this.items = this.items.filter(change => !change.synced);
        this.save();
    },
    hasProcessed(id) { return this.processed.has(id); },
    addProcessed(id) {
        this.processed.add(id);
        if (this.processed.size > 5000) this.processed.clear();
    }
};

let isSyncing = false;
let syncQueued = false;
let isApplyingCloudUpdate = false;
let syncTimer = null;
let connectionListenerRegistered = false;
let syncIntervalId = null;
let appInitializedOnce = false;
let stockMutationChain = Promise.resolve();

const ROOT_COLLECTIONS = new Set([
    'products', 'clients', 'invoices', 'retailSales', 'expenses', 'suppliers',
    'partnerWithdrawals', 'capitalRecords', 'exchanges', 'itemTracks',
    'safeTransactions', 'ledgerEntries', 'adminLogs'
]);

const SINGLETON_COLLECTIONS = new Set(['rates', 'categories', 'system']);

function normalizeEntity(entity, entityId) {
    const normalized = { ...(entity || {}) };
    if (entityId && !normalized.id && !SINGLETON_COLLECTIONS.has(entityId)) normalized.id = entityId;
    if (!normalized._updatedAt) normalized._updatedAt = Date.now();
    if (!normalized._deviceId) normalized._deviceId = DEVICE_ID;
    return normalized;
}

function rootPathForChange(change) {
    if (ROOT_COLLECTIONS.has(change.collection)) return `${change.collection}/${change.entityId}`;
    if (change.collection === 'rates') return 'rates';
    if (change.collection === 'categories') return 'categories';
    if (change.collection === 'system' && change.entityId === 'safes') return 'safes';
    if (change.collection === 'system' && change.entityId === 'invoiceCount') return 'invoiceCount';
    return null;
}

function shouldCoalesceChange(collection, operation) {
    if (operation === 'delete') return true;
    return !SyncQueue.appendOnlyCollections.has(collection);
}

function scheduleDeltaSync(delay = 1500) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        if (navigator.onLine) SyncManager.performDeltaSync();
    }, delay);
}

function trackChange(collection, entityId, operation, data) {
    if (isApplyingCloudUpdate) return;

    const now = Date.now();
    const payload = (data && typeof data === 'object' && !Array.isArray(data))
        ? normalizeEntity(data, entityId)
        : data;

    const baseChange = {
        id: generateUniqueID(),
        collection,
        entityId: String(entityId),
        operation,
        data: payload,
        timestamp: now,
        localSeq: now,
        deviceId: DEVICE_ID,
        synced: false
    };

    if (shouldCoalesceChange(collection, operation)) {
        const existing = SyncQueue.items.find(change =>
            !change.synced &&
            change.collection === collection &&
            change.entityId === String(entityId) &&
            shouldCoalesceChange(change.collection, change.operation)
        );
        if (existing) {
            if (operation === 'delete') {
                existing.operation = 'delete';
                existing.data = { id: String(entityId), _deleted: true, _updatedAt: now, _deviceId: DEVICE_ID };
            } else if (existing.operation !== 'delete') {
                existing.operation = existing.operation === 'create' ? 'create' : operation;
                existing.data = payload;
            }
            existing.timestamp = now;
            existing.localSeq = now;
            existing.deviceId = DEVICE_ID;
            SyncQueue.save();
            scheduleDeltaSync();
            return;
        }
    }

    SyncQueue.add(baseChange);
    scheduleDeltaSync();
}

function arrayToObjectById(arr) {
    const out = {};
    forceArray(arr).forEach(item => {
        if (item && item.id) out[item.id] = item;
    });
    return out;
}

function buildCloudStateSnapshot() {
    const productReport = dedupeProductsSafe(state.products, { source: 'buildCloudStateSnapshot', log: false });
    state.products = productReport.products;
    return {
        products: arrayToObjectById(productReport.products),
        clients: arrayToObjectById(state.clients),
        invoices: arrayToObjectById(state.invoices),
        retailSales: arrayToObjectById(state.retailSales),
        expenses: arrayToObjectById(state.expenses),
        suppliers: arrayToObjectById(state.suppliers),
        partnerWithdrawals: arrayToObjectById(state.partnerWithdrawals),
        capitalRecords: arrayToObjectById(state.capitalRecords),
        exchanges: arrayToObjectById(state.exchanges),
        itemTracks: arrayToObjectById(state.itemTracks),
        safeTransactions: arrayToObjectById(state.safeTransactions),
        ledgerEntries: arrayToObjectById(state.ledgerEntries),
        adminLogs: arrayToObjectById(state.adminLogs),
        categories: state.categories,
        rates: state.rates,
        safes: state.safes,
        invoiceCount: state.invoiceCount,
        syncVersion: state.syncVersion,
        lastSyncTime: state.lastSyncTime || Date.now()
    };
}

async function getPendingImageUploads() {
    return (await localforage.getItem(SYNC_PENDING_IMAGES_KEY)) || [];
}

async function savePendingImageUploads(items) {
    await localforage.setItem(SYNC_PENDING_IMAGES_KEY, items || []);
}

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('فشل قراءة الصورة'));
        reader.readAsDataURL(file);
    });
}

function dataURLToBlob(dataURL) {
    const parts = dataURL.split(',');
    const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    const binary = atob(parts[1]);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

async function queueImageUpload(entityId, dataURL) {
    const pending = await getPendingImageUploads();
    const filtered = pending.filter(item => item.entityId !== entityId);
    const product = state.products.find(item => item && String(item.id) === String(entityId));
    filtered.push({
        id: generateUniqueID(),
        entityId,
        identityKeys: product ? getProductIdentityKeys(product) : [],
        dataURL,
        createdAt: Date.now(),
        attempts: 0
    });
    await savePendingImageUploads(filtered);
}

const SyncManager = {};

SyncManager.collectPendingChanges = function () {
    pruneStaleProductSyncQueue();
    return activeProductSyncChanges(SyncQueue.getPending());
};

SyncManager.downloadRemoteChanges = async function (currentVersion) {
    const access = await ensureFirebaseAccess();
    if (!access.ok) throw new Error('تعذر تسجيل الدخول إلى Firebase: ' + access.error);
    const snapshot = await db.ref('sync/changes')
        .orderByChild('syncVersion')
        .startAt((Number(currentVersion) || 0) + 1)
        .once('value');

    return Object.values(snapshot.val() || {})
        .filter(change => change && change.id && change.timestamp)
        .sort((a, b) => (a.syncVersion || 0) - (b.syncVersion || 0) || (a.timestamp || 0) - (b.timestamp || 0));
};

SyncManager.allocateVersions = async function (pending) {
    if (!pending.length) return [];
    const access = await ensureFirebaseAccess();
    if (!access.ok) throw new Error('تعذر تسجيل الدخول إلى Firebase: ' + access.error);
    const counterRef = db.ref('sync/lastSyncVersion');
    const result = await counterRef.transaction(current => (Number(current) || 0) + pending.length);
    if (!result.committed) throw new Error('تعذر حجز إصدار مزامنة');
    const endVersion = Number(result.snapshot.val()) || pending.length;
    const startVersion = endVersion - pending.length + 1;
    return pending.map((change, index) => ({
        ...change,
        syncVersion: startVersion + index,
        synced: false,
        timestamp: change.timestamp || Date.now(),
        deviceId: change.deviceId || DEVICE_ID
    }));
};

SyncManager.buildUpdates = function (changes) {
    const updates = {};
    activeProductSyncChanges(changes).forEach(change => {
        updates[`sync/changes/${change.id}`] = change;
        const path = rootPathForChange(change);
        if (path) {
            updates[path] = change.operation === 'delete' ? null : change.data;
        }
        if (change.operation === 'delete') {
            updates[`sync/deletions/${change.collection}/${change.entityId}`] = {
                id: change.entityId,
                collection: change.collection,
                deletedAt: change.timestamp,
                syncVersion: change.syncVersion,
                deviceId: change.deviceId
            };
        }
    });
    updates['sync/lastSyncTime'] = Date.now();
    return updates;
};

SyncManager.uploadLocalChanges = async function (pending) {
    await refreshProductsReplacementMarkerFromFirebase();
    pruneStaleProductSyncQueue();
    pending = activeProductSyncChanges(pending);
    if (!pending.length) return 0;
    const access = await ensureFirebaseAccess();
    if (!access.ok) throw new Error('تعذر تسجيل الدخول إلى Firebase: ' + access.error);
    const versionedChanges = await SyncManager.allocateVersions(pending);
    const updates = SyncManager.buildUpdates(versionedChanges);
    await db.ref().update(updates);
    SyncQueue.markSyncedByIds(pending.map(change => change.id));
    SyncQueue.removeSynced();
    const maxVersion = Math.max(state.syncVersion || 0, ...versionedChanges.map(c => c.syncVersion || 0));
    state.syncVersion = maxVersion;
    return versionedChanges.length;
};

SyncManager.processPendingImages = async function () {
    if (!navigator.onLine) return 0;
    let pending = await getPendingImageUploads();
    if (!pending.length) return 0;

    let processed = 0;
    const remaining = [];
    for (const item of pending) {
        const now = Date.now();
        if (item.nextRetryAt && Number(item.nextRetryAt) > now) {
            remaining.push(item);
            continue;
        }
        let product = state.products.find(p => p && String(p.id) === String(item.entityId));
        if (!product && Array.isArray(item.identityKeys) && item.identityKeys.length) {
            const keys = new Set(item.identityKeys);
            product = state.products.find(p => p && getProductIdentityKeys(p).some(key => keys.has(key)));
        }
        if (!product) {
            processed++;
            continue;
        }
        try {
            const blob = dataURLToBlob(item.dataURL);
            const imageUrl = await uploadImageToCloudinary(blob);
            product.image = imageUrl;
            product.imageUploadPending = false;
            product._updatedAt = Date.now();
            product.version = (product.version || 0) + 1;
            trackChange('products', product.id, 'update', product);
            processed++;
        } catch (error) {
            item.attempts = (item.attempts || 0) + 1;
            item.lastError = error.message;
            item.lastAttemptAt = now;
            item.nextRetryAt = now + Math.min(60 * 60 * 1000, Math.pow(2, Math.min(item.attempts, 6)) * 30 * 1000);
            remaining.push(item);
        }
    }
    await savePendingImageUploads(remaining);
    if (processed) await saveToLocal();
    return processed;
};

async function applyRemoteProductChange(change) {
    if (!change || change.collection !== 'products') return false;
    await refreshProductsReplacementMarkerFromFirebase();
    if (isStaleProductSyncChange(change)) {
        if (change.syncVersion > (state.syncVersion || 0)) state.syncVersion = change.syncVersion;
        return false;
    }

    if (change.operation === 'delete') {
        state.products = state.products.filter(item => item && String(item.id) !== String(change.entityId));
        return true;
    }

    if (change.operation !== 'create' && change.operation !== 'update') return false;
    const incoming = normalizeProductRecord(change.data || {}, 0, change.entityId);
    if (!incoming) return false;

    const idx = findProductIndexByIdentity(incoming, change.entityId);
    if (idx >= 0) {
        const local = state.products[idx];
        const localTime = Number(local._updatedAt || local.timestamp || 0);
        const incomingTime = Number(incoming._updatedAt || incoming.timestamp || change.timestamp || 0);
        const localHasPending = SyncQueue.items.some(q =>
            !q.synced &&
            q.collection === 'products' &&
            (String(q.entityId) === String(local.id) || String(q.entityId) === String(change.entityId))
        );
        if (localHasPending && localTime > incomingTime) return false;

        const best = chooseBestProductVersion(local, incoming);
        const duplicate = best === local ? incoming : local;
        state.products[idx] = finalizeProductRecord(mergeProductRecords(best, duplicate));
    } else {
        state.products.unshift(finalizeProductRecord(incoming));
    }

    state.products = dedupeProductsSafe(state.products, { source: 'remote-product-change' }).products;
    return true;
}

SyncManager.applyRemoteChanges = async function (cloudChangesArray) {
    let appliedCount = 0;
    isApplyingCloudUpdate = true;
    try {
        for (const change of cloudChangesArray) {
            const applied = await SyncManager.applyRemoteChange(change);
            if (applied) appliedCount++;
        }
    } finally {
        isApplyingCloudUpdate = false;
    }
    return appliedCount;
};

SyncManager.applyRemoteChange = async function (change) {
    if (!change || !change.id || !change.collection) return false;
    if (change.deviceId === DEVICE_ID) {
        if (change.syncVersion > (state.syncVersion || 0)) state.syncVersion = change.syncVersion;
        SyncQueue.addProcessed(change.id);
        return false;
    }
    if (SyncQueue.hasProcessed(change.id)) return false;
    SyncQueue.addProcessed(change.id);

    if (change.collection === 'rates') {
        state.rates = { ...state.rates, ...(change.data || {}) };
    } else if (change.collection === 'categories') {
        state.categories = forceArray(change.data);
    } else if (change.collection === 'system' && change.entityId === 'safes') {
        state.safes = { ...state.safes, ...(change.data || {}) };
    } else if (change.collection === 'system' && change.entityId === 'invoiceCount') {
        state.invoiceCount = Math.max(Number(state.invoiceCount) || 0, Number(change.data) || 0);
    } else if (ROOT_COLLECTIONS.has(change.collection)) {
        if (change.collection === 'products') {
            const applied = await applyRemoteProductChange(change);
            if (!applied) return false;
        } else {
        const target = state[change.collection];
        if (!Array.isArray(target)) return false;
        const idx = target.findIndex(item => item && String(item.id) === String(change.entityId));
        if (change.operation === 'delete') {
            if (idx >= 0) target.splice(idx, 1);
        } else if (change.operation === 'create' || change.operation === 'update') {
            const incoming = normalizeEntity(change.data || {}, change.entityId);
            if (idx >= 0) {
                const local = target[idx];
                const localTime = Number(local._updatedAt || local.timestamp || local.date || 0);
                const incomingTime = Number(incoming._updatedAt || incoming.timestamp || incoming.date || change.timestamp || 0);
                const localHasPending = SyncQueue.items.some(q => !q.synced && q.collection === change.collection && String(q.entityId) === String(change.entityId));
                if (localHasPending && localTime > incomingTime) return false;
                target[idx] = { ...local, ...incoming };
            } else {
                target.unshift(incoming);
            }
        } else {
            return false;
        }
        }
    } else {
        return false;
    }

    if (change.syncVersion > (state.syncVersion || 0)) state.syncVersion = change.syncVersion;
    state.lastSyncTime = Date.now();
    await saveToLocal();
    return true;
};

SyncManager.finalizeSync = async function () {
    const access = await ensureFirebaseAccess();
    if (!access.ok) throw new Error('تعذر تسجيل الدخول إلى Firebase: ' + access.error);
    const now = Date.now();
    state.lastSyncTime = now;
    await db.ref().update({
        'sync/lastSyncVersion': state.syncVersion || 0,
        'sync/lastSyncTime': now,
        'lastSyncTime': now,
        'syncVersion': state.syncVersion || 0
    });
    if ((state.syncVersion || 0) % 25 === 0) {
        await db.ref('full_backup').set({ ...buildCloudStateSnapshot(), backupTime: now });
    }
    await saveToLocal();
};

SyncManager.performDeltaSync = async function () {
    if (isSyncing) {
        syncQueued = true;
        return { success: true, queued: true };
    }
    if (!navigator.onLine) return { success: false, error: 'No internet' };

    isSyncing = true;
    updateSyncStatus('⏳ جاري المزامنة...');
    showSpinner(true);
    try {
        await SyncManager.processPendingImages();
        const currentVersion = Number(state.syncVersion) || 0;
        const cloudChangesArray = await SyncManager.downloadRemoteChanges(currentVersion);
        const appliedCount = await SyncManager.applyRemoteChanges(cloudChangesArray);
        const pending = SyncManager.collectPendingChanges();
        const uploadedCount = await SyncManager.uploadLocalChanges(pending);

        if (appliedCount > 0 || uploadedCount > 0) {
            await SyncManager.finalizeSync();
            updateAllUI();
        } else {
            await saveToLocal();
        }

        updateSyncStatus('✅ متزامن');
        return {
            success: true,
            cloudChangesApplied: appliedCount,
            localChangesSent: uploadedCount,
            pending: SyncQueue.getPending().length,
            newVersion: state.syncVersion
        };
    } catch (error) {
        console.error('Delta sync failed:', error);
        const friendlyError = explainFirebasePermissionError(error);
        updateSyncStatus('⚠️ فشل المزامنة');
        return { success: false, error: friendlyError };
    } finally {
        showSpinner(false);
        isSyncing = false;
        if (syncQueued) {
            syncQueued = false;
            setTimeout(() => SyncManager.performDeltaSync(), 250);
        }
    }
};

async function fullSync() {
    try {
        const access = await ensureFirebaseAccess();
        if (!access.ok) throw new Error('تعذر تسجيل الدخول إلى Firebase: ' + access.error);
        const snapshot = await db.ref('full_backup').once('value');
        const backup = snapshot.val();

        if (!backup) {
            return { success: false, error: 'No backup found' };
        }

        // ===== إصلاح: دمج البيانات بدلاً من استبدالها =====
        replaceProductsFromSource(backup.products || [], 'fullSync');
        state.clients = mergeById(state.clients, backup.clients || []);
        state.invoices = mergeById(state.invoices, backup.invoices || []);
        state.safes = { ...state.safes, ...(backup.safes || {}) };
        state.syncVersion = Math.max(state.syncVersion, backup.syncVersion || 0);

        await saveToLocal();
        updateAllUI();
        return { success: true, version: state.syncVersion };

    } catch (error) {
        console.error('Full sync failed:', error);
        return { success: false, error: error.message };
    }
}

async function pullFromCloud__legacyMerge() {
    const btn = document.getElementById('pull-btn-ui');
    if (btn) { btn.innerText = "⏳ جاري..."; btn.disabled = true; }

    try {
        const access = await ensureFirebaseAccess();
        if (!access.ok) throw new Error('تعذر تسجيل الدخول إلى Firebase: ' + access.error);
        const snapshot = await db.ref().once('value');
        const data = snapshot.val();

        if (data) {
            // ===== إصلاح جذري: الدمج بدلاً من الاستبدال =====
            if (data.maintenance) writeProductsReplacementMarker(data.maintenance);
            replaceProductsFromSource(data.products !== undefined ? data.products : (data.full_backup && data.full_backup.products) || [], 'pullFromCloud-legacy');
            if (data.categories) state.categories = forceArray(data.categories);
            if (data.clients) state.clients = mergeById(state.clients, forceArray(data.clients));
            if (data.suppliers) state.suppliers = mergeById(state.suppliers, forceArray(data.suppliers));
            if (data.expenses) state.expenses = mergeById(state.expenses, forceArray(data.expenses));
            if (data.invoices) state.invoices = mergeById(state.invoices, forceArray(data.invoices));
            if (data.retailSales) state.retailSales = mergeById(state.retailSales, forceArray(data.retailSales));
            if (data.itemTracks) state.itemTracks = mergeById(state.itemTracks, forceArray(data.itemTracks));
            if (data.rates) state.rates = data.rates;
            if (data.safes) state.safes = data.safes;
            if (data.exchanges) state.exchanges = mergeById(state.exchanges, forceArray(data.exchanges));
            if (data.partnerWithdrawals) state.partnerWithdrawals = mergeById(state.partnerWithdrawals, forceArray(data.partnerWithdrawals));
            if (data.capitalRecords) state.capitalRecords = mergeById(state.capitalRecords, forceArray(data.capitalRecords));
            if (data.ledgerEntries) state.ledgerEntries = mergeById(state.ledgerEntries, forceArray(data.ledgerEntries));
            if (data.invoiceCount) state.invoiceCount = data.invoiceCount;
            state.lastSyncTime = data.lastSyncTime || 0;
            normalizeStateForLegacyData();

            await saveToLocal();
            updateAllUI();
            alert("✅ تم استرجاع البيانات من السحابة بنجاح!");
        } else {
            alert("⚠️ السحابة فارغة.");
        }
    } catch (error) {
        console.error(error);
        alert("❌ حدث خطأ أثناء جلب البيانات.\n" + explainFirebasePermissionError(error));
    } finally {
        if (btn) { btn.innerText = "🔽 استرجاع"; btn.disabled = false; }
    }
}

SyncManager.manualSync = async function () {
    if (isSyncing) return;
    if (!confirm("هل تريد رفع البيانات إلى السحابة؟")) return;

    const result = await SyncManager.performDeltaSync();
    if (result.success) {
        alert("✅ تمت المزامنة بنجاح!");
    } else {
        alert("❌ فشل المزامنة: " + result.error);
    }
}

function updateSyncStatus(text) {
    const el = document.getElementById('sync-status-text');
    if (el) el.innerText = text;
}

function showSpinner(show) {
    const el = document.getElementById('global-spinner');
    if (el) {
        el.classList.toggle('active', show);
    }
}

// ============================================================
// 8. LEDGER SYSTEM (Double-Entry)
// ============================================================
function recordLedgerEntry(account, debit, credit, reference, note) {
    const entry = {
        id: generateUniqueID(),
        timestamp: Date.now(),
        account: account,
        debit: Number(debit) || 0,
        credit: Number(credit) || 0,
        reference: reference || '',
        note: note || '',
        date: new Date().toLocaleString('ar-EG')
    };

    state.ledgerEntries.unshift(entry);

    if (state.ledgerEntries.length > 10000) {
        state.ledgerEntries.length = 10000;
    }

    trackChange('ledgerEntries', entry.id, 'create', entry);
    saveToLocal();
    return entry;
}

function getBalanceSheet() {
    const accounts = {};
    state.ledgerEntries.forEach(e => {
        if (!accounts[e.account]) {
            accounts[e.account] = { debit: 0, credit: 0, balance: 0 };
        }
        accounts[e.account].debit += e.debit;
        accounts[e.account].credit += e.credit;
        accounts[e.account].balance = accounts[e.account].debit - accounts[e.account].credit;
    });
    return accounts;
}

function getTrialBalance() {
    const balanceSheet = getBalanceSheet();
    let totalDebit = 0;
    let totalCredit = 0;

    Object.keys(balanceSheet).forEach(account => {
        totalDebit += balanceSheet[account].debit;
        totalCredit += balanceSheet[account].credit;
    });

    return {
        accounts: balanceSheet,
        totalDebit,
        totalCredit,
        isBalanced: Math.abs(totalDebit - totalCredit) < 0.01
    };
}

function renderLedgerEntries() {
    const list = document.getElementById('ledger-entries-list');
    if (!list) return;

    let html = '';
    state.ledgerEntries.slice(0, 100).forEach(e => {
        const isDebit = e.debit > 0;
        html += `<div style="padding: 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px;">
            <strong>${e.account}</strong>
            <span style="float:left; font-size:11px; color:#64748b;">${e.date}</span>
            <div style="display:flex; gap:10px; margin-top:4px; flex-wrap:wrap;">
                ${isDebit ? `<span style="color:#16a34a;">مدين: ${e.debit.toFixed(2)} $</span>` : `<span style="color:#dc2626;">دائن: ${e.credit.toFixed(2)} $</span>`}
                <span style="color:#64748b; font-size:11px;">${e.note}</span>
                ${e.reference ? `<span style="color:#64748b; font-size:11px;">مرجع: ${e.reference}</span>` : ''}
            </div>
        </div>`;
    });
    list.innerHTML = html || '<p style="text-align:center; color:#64748b;">لا توجد قيود محاسبية</p>';

    const tb = getTrialBalance();
    const tbDisplay = document.getElementById('trial-balance-display');
    if (tbDisplay) {
        let tbHtml = `<div style="background: ${tb.isBalanced ? '#dcfce7' : '#fee2e2'}; padding: 15px; border-radius: 10px;">`;
        tbHtml += `<p><strong>إجمالي المدين:</strong> ${tb.totalDebit.toFixed(2)} $</p>`;
        tbHtml += `<p><strong>إجمالي الدائن:</strong> ${tb.totalCredit.toFixed(2)} $</p>`;
        tbHtml += `<p style="font-weight: bold; color: ${tb.isBalanced ? '#16a34a' : '#dc2626'};">`;
        tbHtml += tb.isBalanced ? '✅ الميزانية متوازنة' : '❌ الميزانية غير متوازنة';
        tbHtml += `</p></div>`;
        tbDisplay.innerHTML = tbHtml;
    }
}

// ============================================================
// 9. SAFE MANAGEMENT
// ============================================================
function updateSafe(currency, amount, operation, note) {
    if (!state.safes[currency]) state.safes[currency] = 0;

    if (operation === 'add') {
        state.safes[currency] += Number(amount);
        addSafeTransaction('deposit', currency, Number(amount), note);
    } else if (operation === 'subtract') {
        if (state.safes[currency] < Number(amount)) {
            throw new Error(`الرصيد غير كافٍ في صندوق ${currencyLabel(currency)}`);
        }
        state.safes[currency] -= Number(amount);
        addSafeTransaction('withdraw', currency, Number(amount), note);
    } else {
        throw new Error('عملية غير صالحة');
    }

    trackChange('system', 'safes', 'update', state.safes);
    saveToLocal();
    return state.safes[currency];
}

function addSafeTransaction(type, currency, amount, note) {
    const trans = {
        id: generateUniqueID(),
        type,
        currency,
        amount: Number(amount) || 0,
        note: note || '',
        date: Date.now()
    };
    state.safeTransactions.unshift(trans);

    if (state.safeTransactions.length > 10000) {
        state.safeTransactions.length = 10000;
    }

    trackChange('safeTransactions', trans.id, 'create', trans);
    saveToLocal();
    renderSafeTransactions();
}

function renderSafeTransactions() {
    const list = document.getElementById('safe-transactions-list');
    if (!list) return;

    let html = '';
    state.safeTransactions.slice(0, 100).forEach(t => {
        const d = new Date(t.date);
        const color = t.type === 'withdraw' ? '#e53935' : '#2e7d32';
        html += `
        <div style="padding:8px; margin-bottom:6px; border-bottom:1px solid #ddd; color:${color};">
            ${t.type === 'invoice' ? '🧾' : t.type === 'withdraw' ? '💸' : '💰'}
            <b>${currencyLabel(t.currency)}</b>
            ${t.type === 'withdraw' ? '-' : '+'} ${t.amount}
            <span style="float:left;font-size:11px;color:#666">${d.toLocaleString('ar-EG')}</span>
            <div style="font-size:12px;margin-top:4px">${t.note || ''}</div>
        </div>`;
    });
    list.innerHTML = html || '<p style="text-align:center;color:#666">لا توجد حركات صندوق</p>';
}

// ============================================================
// 10. INVENTORY MANAGEMENT (مع إصلاح الحفظ الفوري)
// ============================================================
async function atomicStockUpdate(productId, quantity, operation) {
    return stockMutationChain = stockMutationChain.then(async () => {
        const product = state.products.find(p => String(p.id) === String(productId) || String(p.code || '') === String(productId));
        if (!product) throw new Error('المنتج غير موجود');

        const qty = Number(quantity) || 0;
        if (qty <= 0) throw new Error('الكمية غير صالحة');

        if (operation === 'subtract' && Number(product.stock || 0) < qty) {
            throw new Error(`الكمية غير متوفرة. المتوفر: ${product.stock}`);
        }

        product.stock = operation === 'subtract'
            ? Number(product.stock || 0) - qty
            : Number(product.stock || 0) + qty;
        product.version = (product.version || 0) + 1;
        product._updatedAt = Date.now();
        product._deviceId = DEVICE_ID;

        trackChange('products', product.id, 'update', product);
        await saveToLocal();
        return product;
    }).catch(error => {
        stockMutationChain = Promise.resolve();
        throw error;
    });
}

function addTrackRecord(prodId, prodName, type, qty, note) {
    const record = {
        id: generateUniqueID(),
        prodId,
        name: prodName,
        type,
        qty,
        note,
        date: new Date().toLocaleString('ar-EG'),
        timestamp: Date.now()
    };

    state.itemTracks.unshift(record);

    if (state.itemTracks.length > 2000) {
        state.itemTracks.length = 2000;
    }

    trackChange('itemTracks', record.id, 'create', record);
    saveToLocal();
    return record;
}

// ============================================================
// 11. UI HELPERS (مع إصلاح switchTab)
// ============================================================
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('alfares_dark_mode', document.body.classList.contains('dark-mode'));
}
if (localStorage.getItem('alfares_dark_mode') === 'true') {
    document.body.classList.add('dark-mode');
}

function toggleSidebar() {
    document.getElementById('app-nav-bar').classList.toggle('sidebar-open');
    document.getElementById('sidebar-overlay').classList.toggle('active');
}

// ===== إصلاح switchTab: التعامل مع العنصر الاختياري =====
function switchTab(tabId, element) {
    document.querySelectorAll('.tab-content').forEach(tab => { tab.classList.remove('active'); });
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));

    const targetTab = document.getElementById('tab-' + tabId);
    if (targetTab) targetTab.classList.add('active');
    if (element) element.classList.add('active');

    calculateDashboard();
    if (document.getElementById('app-nav-bar').classList.contains('sidebar-open')) { toggleSidebar(); }
    
    if (tabId === 'ledger') {
        renderLedgerEntries();
    }
}

function updateLiveMetaBar() {
    const now = new Date();
    const dateBox = document.getElementById('inv-date-time-box');
    const idBox = document.getElementById('inv-id-display');
    if (dateBox) {
        const formattedDate = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`;
        dateBox.innerText = `الوقت والتاريخ: ${now.toLocaleTimeString('ar-EG')} | ${formattedDate}`;
    }
    if (idBox && !editingInvoiceId) idBox.innerText = String(state.invoiceCount).padStart(5, '0');
}
if (window.__ABN_LIVE_META_INTERVAL__) clearInterval(window.__ABN_LIVE_META_INTERVAL__);
window.__ABN_LIVE_META_INTERVAL__ = setInterval(updateLiveMetaBar, 30000);

let firebaseConnectionWatchStarted = false;
function checkConnection() {
    const status = document.getElementById('connection-status');
    if (!status) return;
    if (!firebaseConnectionWatchStarted) {
        const connectionRef = db.ref('.info/connected');
        if (window.__ABN_FIREBASE_CONNECTION_REF__ && window.__ABN_FIREBASE_CONNECTION_CALLBACK__) {
            try { window.__ABN_FIREBASE_CONNECTION_REF__.off('value', window.__ABN_FIREBASE_CONNECTION_CALLBACK__); } catch (_) {}
        }
        window.__ABN_FIREBASE_CONNECTION_REF__ = connectionRef;
        window.__ABN_FIREBASE_CONNECTION_CALLBACK__ = function abnFirebaseConnectionStatusHandler(snap) {
            if (snap.val() === true) {
                status.innerText = '🟢 متصل';
                status.style.color = 'white';
                if (window.ABNRuntimeStability && typeof window.ABNRuntimeStability.requestSync === 'function') {
                    window.ABNRuntimeStability.requestSync('firebase-connected');
                } else {
                    SyncManager.processPendingImages().then(() => SyncManager.performDeltaSync()).catch(console.error);
                }
            } else {
                status.innerText = '🔴 غير متصل';
                status.style.color = '#f87171';
            }
        };
        connectionRef.on('value', window.__ABN_FIREBASE_CONNECTION_CALLBACK__);
        firebaseConnectionWatchStarted = true;
    }
    if (!navigator.onLine) {
        status.innerText = '🔴 غير متصل';
        status.style.color = '#f87171';
    }
}

// ============================================================
// 12. DASHBOARD
// ============================================================
function calculateDashboard() {
    let totalStockCost = 0;
    state.products.forEach(p => { if (p && typeof p.cost === 'number' && typeof p.stock === 'number') totalStockCost += (p.cost * p.stock); });
    let totalExpUsd = 0;
    state.expenses.forEach(e => { if (e && e.usdEquivalent) totalExpUsd += e.usdEquivalent; });
    let totalDebts = 0;
    state.clients.forEach(c => { if (c && c.balance) totalDebts += c.balance; });
    let totalSupDebts = 0;
    state.suppliers.forEach(s => { if (s && s.balance) totalSupDebts += s.balance; });

    let actualInvSales = 0;
    let actualInvProfit = 0;
    state.invoices.forEach(inv => { if (inv) { actualInvSales += (inv.total || 0);
            actualInvProfit += (inv.profit || 0); } });
    let actualRetSales = 0;
    let actualRetProfit = 0;
    state.retailSales.forEach(r => { if (r) { actualRetSales += (r.total || 0);
            actualRetProfit += (r.profit || 0); } });

    let overallSales = actualInvSales + actualRetSales;
    let netProfit = (actualInvProfit + actualRetProfit) - totalExpUsd;

    document.getElementById('db-safe-usd').innerText = (state.safes.usd || 0).toFixed(2);
    document.getElementById('db-safe-try').innerText = (state.safes.try || 0).toFixed(2);
    document.getElementById('db-safe-syp').innerText = (state.safes.syp || 0).toFixed(0);

    document.getElementById('db-sales').innerText = overallSales.toFixed(2) + " $";
    document.getElementById('db-purchases').innerText = totalStockCost.toFixed(2) + " $";
    document.getElementById('db-profit').innerText = netProfit.toFixed(2) + " $";
    document.getElementById('db-total-debts').innerText = totalDebts.toFixed(2);
    document.getElementById('db-suppliers-debts').innerText = totalSupDebts.toFixed(2) + " $";
    document.getElementById('db-inv-sales').innerText = actualInvSales.toFixed(2);
    document.getElementById('db-retail-sales').innerText = actualRetSales.toFixed(2);
    document.getElementById('db-expenses').innerText = totalExpUsd.toFixed(2);
    document.getElementById('db-prod-count').innerText = state.products.filter(p => p != null).length;
    document.getElementById('db-sync-version').innerText = state.syncVersion;

    calculateProfitStats();
}

function calculateProfitStats() {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startWeek = startToday - (7 * 24 * 60 * 60 * 1000);
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const startYear = new Date(now.getFullYear(), 0, 1).getTime();

    let dayProfit = 0, weekProfit = 0, monthProfit = 0, yearProfit = 0;

    [...state.invoices, ...state.retailSales].forEach(item => {
        const profit = Number(item.profit || 0);
        const time = Number(item.timestamp || 0);
        if (time >= startToday) dayProfit += profit;
        if (time >= startWeek) weekProfit += profit;
        if (time >= startMonth) monthProfit += profit;
        if (time >= startYear) yearProfit += profit;
    });

    document.getElementById('profit-day').innerText = dayProfit.toFixed(2) + ' $';
    document.getElementById('profit-week').innerText = weekProfit.toFixed(2) + ' $';
    document.getElementById('profit-month').innerText = monthProfit.toFixed(2) + ' $';
    document.getElementById('profit-year').innerText = yearProfit.toFixed(2) + ' $';
}


function normalizeProductSearchText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function findMatchingProductsForSearch(keyword) {
    const normalizedKeyword = normalizeProductSearchText(keyword);
    if (!normalizedKeyword) return [];

    const tokens = normalizedKeyword.split(' ').filter(Boolean);
    const scored = [];

    state.products.forEach(product => {
        if (!product || !product.name || Number(product.stock || 0) <= 0) return;

        const searchableName = normalizeProductSearchText(product.name);
        const searchableCategory = normalizeProductSearchText(product.category || '');
        const searchableCode = normalizeProductSearchText(product.code || product.barcode || '');
        const fullSearchText = `${searchableName} ${searchableCategory} ${searchableCode}`.trim();

        // مهم: كل الكلمات المكتوبة يجب أن تكون موجودة، حتى لا تظهر كل المنتجات عند كتابة كلمة عامة فقط.
        const allTokensMatch = tokens.every(token => fullSearchText.includes(token));
        if (!allTokensMatch) return;

        let score = 0;
        if (searchableName === normalizedKeyword) score += 1000;
        if (searchableName.startsWith(normalizedKeyword)) score += 500;
        if (searchableName.includes(normalizedKeyword)) score += 250;
        score += Math.max(0, 100 - searchableName.length);

        scored.push({ product, score });
    });

    return scored
        .sort((a, b) => b.score - a.score || String(a.product.name).localeCompare(String(b.product.name), 'ar'))
        .map(item => item.product)
        .slice(0, 40);
}

// ============================================================
// 13. RETAIL SALES
// ============================================================
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]|'/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[ch]));
}

function renderProductSearchResults(containerId, products, onSelectFnName) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!products || !products.length) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    container.innerHTML = products.map(p => {
        const id = escapeHtml(p.id);
        const name = escapeHtml(p.name || 'بدون اسم');
        const price = formatPrice(p.retail, 'usd');
        const stock = Number(p.stock || 0);
        return `<div class="product-search-result-item" onclick="${onSelectFnName}('${id}')">${name}<span class="product-search-result-meta">السعر: ${price} - المتوفر: ${stock}</span></div>`;
    }).join('');
    container.style.display = 'block';
}

function hideProductSearchResults(containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = '';
        container.style.display = 'none';
    }
}

function filterRetailProducts() {
    const input = document.getElementById('ret-search-input');
    const keyword = input.value.trim();
    const select = document.getElementById('ret-product-select');

    select.innerHTML = '';
    select.value = '';
    select.style.display = 'none'; // لا نعرض select الأصلي حتى لا يظهر مربع أبيض أو قائمة كل المنتجات على الهاتف.

    if (!keyword) {
        hideProductSearchResults('ret-product-results');
        calculateRetailTotal();
        return;
    }

    const results = findMatchingProductsForSearch(keyword);
    renderProductSearchResults('ret-product-results', results, 'chooseRetailProduct');
}
// البحث يجب أن يكون فورياً، لا نؤخره حتى لا يفتح الهاتف قائمة قديمة أو غير مفلترة.
const debouncedFilterRetail = filterRetailProducts;

function chooseRetailProduct(productId) {
    const select = document.getElementById('ret-product-select');
    select.value = String(productId || '');
    select.innerHTML = `<option value="${escapeHtml(productId)}" selected></option>`;
    selectRetailProduct();
}

function selectRetailProduct() {
    const select = document.getElementById('ret-product-select');
    const prod = state.products.find(p => p && String(p.id) === String(select.value));
    if (prod) {
        document.getElementById('ret-search-input').value = prod.name;
        document.getElementById('ret-price').value = prod.retail || 0;
        hideProductSearchResults('ret-product-results');
        calculateRetailTotal();
    }
}

function calculateRetailTotal() {
    const qty = parseInt(document.getElementById('ret-qty').value) || 1;
    const price = parseFloat(document.getElementById('ret-price').value) || 0;
    const totalUsd = price * qty;
    document.getElementById('ret-total-preview').innerText = totalUsd.toFixed(2);
    let curr = document.getElementById('ret-currency').value;
    let eqText = "";
    if (curr === 'try' && state.rates.try > 0) { eqText = `≈ ${(totalUsd * state.rates.try).toFixed(2)} ₺`; } else if (curr === 'syp' && state.rates.syp > 0) { eqText = `≈ ${(totalUsd * state.rates.syp).toFixed(0)} ل.س`; }
    document.getElementById('ret-eq-text').innerText = eqText;
    let paidValue = parseFloat(document.getElementById('ret-paid-amount')?.value) || 0;
    let paidCurrency = document.getElementById('ret-paid-currency')?.value || 'usd';
    let paidUsd = paidValue;
    if (paidCurrency === 'try' && state.rates.try > 0) { paidUsd = paidValue / state.rates.try; } else if (paidCurrency === 'syp' && state.rates.syp > 0) { paidUsd = paidValue / state.rates.syp; }
    document.getElementById('ret-paid-eq').innerText = `يعادل ${paidUsd.toFixed(2)} $`;
}

function toggleRetailClientSelect() {
    const isDebt = document.getElementById('ret-payment-type').value === 'debt';
    document.getElementById('ret-client-group').style.display = isDebt ? 'block' : 'none';
    document.getElementById('ret-currency-group').style.display = isDebt ? 'none' : 'block';
}

async function submitRetailSale() {
    const prodId = document.getElementById('ret-product-select').value;
    const qty = parseInt(document.getElementById('ret-qty').value) || 1;
    const manualPrice = parseFloat(document.getElementById('ret-price').value) || 0;
    const payType = document.getElementById('ret-payment-type').value;
    const curr = document.getElementById('ret-currency').value;
    const clientName = document.getElementById('ret-client-select').value;
    const paidAmount = parseFloat(document.getElementById('ret-paid-amount')?.value) || 0;
    const paidCurrency = document.getElementById('ret-paid-currency')?.value || 'usd';

    let paidUsd = paidAmount;
    if (paidCurrency === 'try' && state.rates.try > 0) { paidUsd = paidAmount / state.rates.try; } else if (paidCurrency === 'syp' && state.rates.syp > 0) { paidUsd = paidAmount / state.rates.syp; }

    if (!prodId) return alert("الرجاء اختيار قطعة!");
    if (qty <= 0 || manualPrice < 0 || paidAmount < 0) return;

    const prod = state.products.find(p => p && (String(p.id)===String(prodId) || String(p.code||'')===String(prodId)));
    if (!prod) return alert("المنتج غير موجود! يرجى تحديث الصفحة.");
    
    if (prod.stock < qty) return alert(`عذراً! المتوفر هو ${prod.stock} قطع.`);
    if (payType === 'debt' && !clientName) return alert("الرجاء اختيار العميل من الدفتر!");

    const totalSaleUsd = manualPrice * qty;
    if (paidUsd > totalSaleUsd) return alert("الدفعة أكبر من قيمة البيع");
    if (payType !== 'debt' && Math.abs(paidUsd - totalSaleUsd) > 0.01) return alert("البيع النقدي يجب أن يكون مدفوعًا بالكامل، أو اختر نوع الدفع: دين.");

    const btn = document.getElementById('btn-submit-retail');
    btn.disabled = true;

    try {
        await atomicStockUpdate(prod.id, qty, 'subtract');

        const profitEarned = totalSaleUsd - ((prod.cost || 0) * qty);
        let currencyRecorded = 'usd', amountRecorded = totalSaleUsd;
        let transId = generateUniqueID();

        if (payType === 'debt') {
            const client = state.clients.find(c => c && c.name === clientName);
            if (client) {
                const remainingDebt = Math.max(0, totalSaleUsd - paidUsd);
                const balanceBefore = client.balance || 0;
                client.balance = (client.balance || 0) + remainingDebt;
                if (!client.transactions) client.transactions = [];
                client.transactions.unshift({
                    id: transId,
                    type: 'retail',
                    amount: remainingDebt,
                    date: Date.now(),
                    note: 'بيع مفرق دين',
                    balanceBefore: balanceBefore,
                    balanceAfter: client.balance
                });
                
                trackChange('clients', client.id, 'update', client);

                currencyRecorded = paidCurrency;
                amountRecorded = paidAmount;
                if (paidAmount > 0) {
                    updateSafe(paidCurrency, paidAmount, 'add', `بيع مفرق دين - ${prod.name}`);
                }
                if (remainingDebt > 0) {
                    recordLedgerEntry('ذمم العملاء', remainingDebt, 0, `دين مفرق - ${clientName}`, `بيع ${prod.name}`);
                    recordLedgerEntry('إيرادات المبيعات', 0, remainingDebt, `دين مفرق - ${clientName}`, `بيع ${prod.name}`);
                }
            }
        } else {
            currencyRecorded = paidCurrency;
            amountRecorded = paidAmount;
            if (paidAmount > 0) {
                updateSafe(paidCurrency, paidAmount, 'add', `بيع مفرق - ${prod.name}`);
            }
        }

        if (paidUsd > 0) {
            recordLedgerEntry('صندوق ' + currencyLabel(paidCurrency), paidUsd, 0, `بيع مفرق`, `بيع ${prod.name}`);
            recordLedgerEntry('إيرادات المبيعات', 0, totalSaleUsd, `بيع مفرق`, `بيع ${prod.name}`);
        }

        const newSale = {
            id: generateUniqueID(),
            transId: transId,
            timestamp: Date.now(),
            prodId: prod.id,
            name: prod.name,
            qty: qty,
            total: totalSaleUsd,
            debtAmount: payType === 'debt' ? Math.max(0, totalSaleUsd - paidUsd) : 0,
            profit: profitEarned,
            payType: payType,
            currency: currencyRecorded || 'usd',
            actualPaid: Number(amountRecorded || 0),
            clientName: payType === 'debt' ? clientName : '',
            date: new Date().toLocaleTimeString('ar-EG')
        };

        state.retailSales.unshift(newSale);
        trackChange('retailSales', newSale.id, 'create', newSale);

        addTrackRecord(prod.id, prod.name, 'بيع مفرق', -qty, `مبيع مفرق بسعر ${manualPrice}$`);
        saveToLocal();
        updateRetailSalesUI();
        calculateDashboard();

        document.getElementById('ret-search-input').value = '';
        document.getElementById('ret-product-select').value = '';
        document.getElementById('ret-qty').value = '1';
        document.getElementById('ret-price').value = '0';
        document.getElementById('ret-total-preview').innerText = '0.00';
        document.getElementById('ret-eq-text').innerText = '';
        btn.disabled = false;
        alert("✅ تم تسجيل المبيع بنجاح!");
    } catch (err) {
        alert(err.message);
        btn.disabled = false;
    }
}

function deleteRetailSale(id) {
    if (!confirm("هل تريد إلغاء هذه البيعة واسترجاعها؟")) return;
    const idx = state.retailSales.findIndex(r => r && r.id === id);
    if (idx === -1) return;
    const sale = state.retailSales[idx];
    const prod = state.products.find(p => p && p.id === sale.prodId);

    if (prod) {
        prod.stock = Math.max(0, Number(prod.stock || 0) + Number(sale.qty || 0));
        prod.version = (prod.version || 0) + 1;
        prod._updatedAt = Date.now();
        trackChange('products', prod.id, 'update', prod);
        addTrackRecord(prod.id, prod.name, 'استرجاع', sale.qty, 'إلغاء بيع مفرق');
    }

    if (sale.payType === 'debt' && sale.clientName) {
        const client = state.clients.find(c => c && c.name === sale.clientName);
        if (client) {
            client.balance = Math.max(0, (client.balance || 0) - Number(sale.debtAmount || 0));
            if (client.transactions && sale.transId) {
                client.transactions = client.transactions.filter(t => t.id !== sale.transId);
            }
            trackChange('clients', client.id, 'update', client);
        }
    }

    let curr = sale.currency || 'usd';
    let paid = Math.max(0, Number(sale.actualPaid || 0));
    if (paid > 0) {
        try {
            updateSafe(curr, paid, 'subtract', `إلغاء بيع مفرق: ${sale.name}`);
        } catch (err) { console.warn('Could not revert safe:', err); }
    }
    
    state.retailSales.splice(idx, 1);
    trackChange('retailSales', sale.id, 'delete', { id: sale.id });
    
    saveToLocal();
    updateRetailSalesUI();
    calculateDashboard();
    addAdminLog("إلغاء بيع مفرق", `تم إلغاء مبيع: ${sale.name} بقيمة ${sale.total}$`);
}

function updateRetailSalesUI() {
    const list = document.getElementById('retail-sales-list');
    if (!list) return;
    let html = '';
    const currNames = { usd: '$', try: '₺', syp: 'ل.س' };
    state.retailSales.forEach(r => {
        if (!r) return;
        const safeName = escapeHtml(r.name || '');
        const safeDate = escapeHtml(r.date || '');
        const safeId = escapeHtml(r.id || '');
        const safeClient = escapeHtml(r.clientName || '');
        const typeTag = r.payType === 'debt' ? `<span style="color:var(--danger-color);">[دين لـ ${safeClient}]</span>` : `<span style="color:#64748b;">[دفع: ${Number(r.actualPaid || r.total).toFixed(2)} ${currNames[r.currency || 'usd']}]</span>`;
        html += `<div class="data-list-item"><div><strong>${safeName} (${Number(r.qty)||0} قطع)</strong> <br><small>${safeDate}</small></div><div style="text-align: left;"><span style="color:var(--success-color); font-weight:bold; display:block;">+${Number(r.total||0).toFixed(2)}$ ${typeTag}</span><button class="action-btn" style="background:#ef4444; color:white; border:none;" onclick="deleteRetailSale('${safeId}')">❌ إلغاء</button></div></div>`;
    });
    list.innerHTML = html;
}

// ============================================================
// 14. INVOICES (مع إصلاح حساب الأرباح)
// ============================================================
let currentInvoiceItems = [];
let editingInvoiceId = null;

function updateInvoiceClientName() {
    document.getElementById('inv-client-name').innerText = document.getElementById('inv-client-select').value;
}

function filterInvoiceProducts() {
    const input = document.getElementById('inv-search-input');
    const keyword = input.value.trim();
    const select = document.getElementById('inv-product-select');

    select.innerHTML = '';
    select.value = '';
    select.style.display = 'none'; // لا نعرض select الأصلي حتى لا يظهر مربع أبيض أو قائمة كل المنتجات على الهاتف.

    if (!keyword) {
        hideProductSearchResults('inv-product-results');
        return;
    }

    const results = findMatchingProductsForSearch(keyword);
    renderProductSearchResults('inv-product-results', results, 'chooseInvoiceProduct');
}
// البحث يجب أن يكون فورياً، لا نؤخره حتى لا يفتح الهاتف قائمة قديمة أو غير مفلترة.
const debouncedFilterInvoice = filterInvoiceProducts;

function chooseInvoiceProduct(productId) {
    const select = document.getElementById('inv-product-select');
    select.value = String(productId || '');
    select.innerHTML = `<option value="${escapeHtml(productId)}" selected></option>`;
    addProductToInvoice();
}

function addProductToInvoice() {
    const prodId = document.getElementById('inv-product-select').value;
    const prod = state.products.find(p => p && (String(p.id)===String(prodId) || String(p.code||'')===String(prodId)));
    if (prod) {
        const priceType = document.getElementById('invoice-price-type').value;
        const selectedPrice = priceType === 'wholesale' ? (prod.wholesale || 0) : (prod.retail || 0);
        currentInvoiceItems.push({
            prodId: prod.id,
            name: prod.name,
            image: prod.image || "",
            qty: 1,
            price: selectedPrice,
            cost: prod.cost,
            maxStock: prod.stock,
            version: prod.version || 1
        });
        document.getElementById('inv-search-input').value = '';
        document.getElementById('inv-product-select').style.display = 'none';
        hideProductSearchResults('inv-product-results');
        renderInvoiceTable();
    }
}


// إخفاء نتائج البحث عند الضغط خارج مربع البحث حتى لا تبقى قائمة مفتوحة فوق الواجهة.
if (window.__ABN_GLOBAL_SEARCH_OUTSIDE_CLICK__) {
    document.removeEventListener('click', window.__ABN_GLOBAL_SEARCH_OUTSIDE_CLICK__);
}
window.__ABN_GLOBAL_SEARCH_OUTSIDE_CLICK__ = function abnGlobalSearchOutsideClick(event) {
    const retailBox = document.getElementById('ret-search-input')?.closest('.form-group');
    const invoiceBox = document.getElementById('inv-search-input')?.closest('.form-group');
    const trackingBox = document.getElementById('track-search-input')?.closest('.form-group');
    if (retailBox && !retailBox.contains(event.target)) hideProductSearchResults('ret-product-results');
    if (invoiceBox && !invoiceBox.contains(event.target)) hideProductSearchResults('inv-product-results');
    if (trackingBox && !trackingBox.contains(event.target)) hideProductSearchResults('track-product-results');
};
document.addEventListener('click', window.__ABN_GLOBAL_SEARCH_OUTSIDE_CLICK__);

function updateInvItem(index, field, value) {
    let val = parseFloat(value);
    if (val < 0) return;
    if (field === 'qty') {
        if (val > currentInvoiceItems[index].maxStock) { alert("الكمية المطلوبة أكبر من المتوفر!");
            val = currentInvoiceItems[index].maxStock; }
        if (val < 1) val = 1;
    }
    currentInvoiceItems[index][field] = val;
    renderInvoiceTable();
}

function removeInvoiceItem(index) {
    currentInvoiceItems.splice(index, 1);
    renderInvoiceTable();
}

function renderInvoiceTable() {
    const tbody = document.getElementById('invoice-items-tbody');
    let html = '';
    let total = 0;
    currentInvoiceItems.forEach((item, index) => {
        if (!item) return;
        total += (item.qty * item.price);
        const prod = state.products.find(p => p && p.id === item.prodId);
        const displayName = item.name || (prod && prod.name) || 'منتج قديم غير موجود في المخزون';
        const maxStock = Number(item.maxStock || (prod && prod.stock) || item.qty || 1);
        html += `<tr>
            <td>${index + 1}</td>
            <td>${prod && prod.image ? `<img src="${escapeHtml(prod.image)}" style="width:40px; height:40px; object-fit:cover; border-radius:4px;">` : `<div class="no-image"></div>`}</td>
            <td>${escapeHtml(displayName)}</td>
            <td><input type="number" class="hide-on-print" value="${item.qty}" min="1" max="${maxStock}" onchange="updateInvItem(${index}, 'qty', this.value)" style="padding:2px;width:100%;text-align:center;font-size:11px;"><span class="print-show-span">${item.qty}</span></td>
            <td><input type="number" class="hide-on-print" value="${item.price}" step="0.01" min="0" onchange="updateInvItem(${index}, 'price', this.value)" style="padding:2px;width:100%;text-align:center;font-size:11px;"><span class="print-show-span">${item.price}</span></td>
            <td class="hide-on-print"><button onclick="removeInvoiceItem(${index})" style="background:var(--danger-color); padding:2px 6px; font-size:11px; border:none; border-radius:3px; color:white; width:auto;">✕</button></td>
        </tr>`;
    });
    tbody.innerHTML = html;
    document.getElementById('invoice-total').innerText = total.toFixed(2);
    calculateInvoiceTotal();
}

function calculateInvoiceTotal() {
    let totalUSD = 0;
    currentInvoiceItems.forEach(item => { totalUSD += (item.price * item.qty); });

    const discount = parseFloat(document.getElementById('inv-discount')?.value) || 0;
    totalUSD = Math.max(0, totalUSD - discount);

    document.getElementById('invoice-total').innerText = totalUSD.toFixed(2);

    let inputValue = parseFloat(document.getElementById('inv-paid-amount').value) || 0;
    let curr = document.getElementById('inv-currency').value;
    let paidUsd = 0;

    // ===== إصلاح: التحقق من أسعار الصرف قبل القسمة =====
    if (curr === 'usd') { paidUsd = inputValue; }
    else if (curr === 'try' && state.rates.try > 0) { paidUsd = inputValue / state.rates.try; }
    else if (curr === 'syp' && state.rates.syp > 0) { paidUsd = inputValue / state.rates.syp; }
    else { paidUsd = 0; }

    let remaining = Number((totalUSD - paidUsd).toFixed(2));
    if (Math.abs(remaining) <= 0.01) { remaining = 0; }

    document.getElementById('invoice-paid-display').innerText = paidUsd.toFixed(2) + " $";
    document.getElementById('invoice-remaining').innerText = remaining.toFixed(2);

    const liveCurrencies = document.getElementById('invoice-live-currencies');
    if (liveCurrencies) {
        const tryValue = state.rates.try > 0 ? totalUSD * state.rates.try : 0;
        const sypValue = state.rates.syp > 0 ? totalUSD * state.rates.syp : 0;
        liveCurrencies.innerHTML = `
            <div style="display:flex; justify-content:center; gap:10px; align-items:center; direction:rtl; flex-wrap:wrap;">
                <span style="background:rgba(255,255,255,.14); padding:6px 10px; border-radius:999px;">💵 الدولار: $ ${totalUSD.toFixed(2)}</span>
                <span style="background:rgba(255,255,255,.14); padding:6px 10px; border-radius:999px;">💶 التركي: ₺ ${tryValue.toFixed(1)}</span>
                <span style="background:rgba(255,255,255,.14); padding:6px 10px; border-radius:999px;">💷 السوري: ل.س ${Math.round(sypValue)}</span>
            </div>`;
    }
}

function shareWhatsApp() {
    if (!currentInvoiceItems || currentInvoiceItems.length === 0) return alert("الفاتورة فارغة!");
    let invNum = editingInvoiceId ? document.getElementById('inv-id-display').innerText : String(state.invoiceCount).padStart(5, '0');
    let clientName = document.getElementById('inv-client-select').value;
    let text = `*اسم المتجر* 🏍️\n------------------------\n📄 فاتورة رقم: ${invNum}\n👤 العميل: ${clientName}\n\n*تفاصيل المشتريات:*\n`;
    currentInvoiceItems.forEach((item, i) => { text += `${i + 1}- ${item.name} | العدد: ${item.qty} | السعر: ${item.price}$\n`; });
    text += `-------------------------
💰 الإجمالي: ${document.getElementById('invoice-total').innerText} $

💵 المدفوع: ${document.getElementById('inv-paid-amount').value}
${document.getElementById('inv-currency').options[document.getElementById('inv-currency').selectedIndex].text}

🔴 الباقي: ${document.getElementById('invoice-remaining').innerText} $

🌹 نسعد بتعاملكم معنا`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

async function saveAndPrintInvoice() {
    if (!currentInvoiceItems || currentInvoiceItems.length === 0) return alert("الفاتورة فارغة!");
    const clientName = document.getElementById('inv-client-select').value;
    const total = parseFloat(document.getElementById('invoice-total').innerText);
    const discount = parseFloat(document.getElementById('inv-discount')?.value) || 0;
    const inputValue = parseFloat(document.getElementById('inv-paid-amount').value) || 0;
    const curr = document.getElementById('inv-currency').value;

    if (discount < 0 || inputValue < 0) return;

    let paidUsd = 0;
    let actualPaidAmount = inputValue;
    if (curr === 'usd') { paidUsd = inputValue; }
    else if (curr === 'try' && state.rates.try > 0) { paidUsd = inputValue / state.rates.try; }
    else if (curr === 'syp' && state.rates.syp > 0) { paidUsd = inputValue / state.rates.syp; }
    else { paidUsd = 0; }

    if (paidUsd > total) return alert("الدفعة أكبر من قيمة الفاتورة");

    let remaining = total - paidUsd;
    if (Math.abs(remaining) <= 0.50) { remaining = 0; }

    if (clientName === 'عام' && remaining > 0) return alert("لا يمكن تسجيل ذمة على عميل عام!");

    const backupProducts = JSON.stringify(state.products);
    const backupClients = JSON.stringify(state.clients);
    const backupSafes = JSON.stringify(state.safes);

    try {
        const newId = editingInvoiceId || generateUniqueID();
        let transId = generateUniqueID();
        const currentInvNumber = editingInvoiceId ? document.getElementById('inv-id-display').innerText : state.invoiceCount;

        if (editingInvoiceId) {
            const oldInvIndex = state.invoices.findIndex(i => i && i.id === editingInvoiceId);
            if (oldInvIndex !== -1) {
                let oldInv = state.invoices[oldInvIndex];
                if (!oldInv) { throw new Error('OLD_INVOICE_NOT_FOUND'); }
                
                for (let oldItem of (oldInv.items || [])) {
                    let p = state.products.find(x => x && x.id == oldItem.prodId);
                    if (p) {
                        p.stock += oldItem.qty;
                        p.version = (p.version || 0) + 1;
                        p._updatedAt = Date.now();
                        trackChange('products', p.id, 'update', p);
                        addTrackRecord(p.id, p.name, 'تعديل فاتورة', oldItem.qty, `تعديل #${oldInv.number}`);
                    }
                }
                
                if (oldInv && Number(oldInv.remaining || 0) > 0) {
                    let c = state.clients.find(x => x && x.name === oldInv.clientName);
                    if (c) {
                        c.balance = Math.max(0, Number(c.balance || 0) - Number(oldInv.remaining || 0));
                        if (Array.isArray(c.transactions) && oldInv.transId) {
                            c.transactions = (c.transactions || []).filter(t => t && t.id !== oldInv.transId);
                        }
                        trackChange('clients', c.id, 'update', c);
                    }
                }
                try {
                    updateSafe(oldInv.currency || 'usd', (oldInv.actualPaid || oldInv.paid), 'subtract', `إلغاء فاتورة قديمة #${oldInv.number}`);
                } catch (err) { console.warn('Could not revert safe:', err); }
                state.invoices.splice(oldInvIndex, 1);
            }
        }

        // ===== إصلاح حساب الأرباح: خصم الحسم بعد حساب الربح =====
        let currentProfit = 0;
        for (let item of currentInvoiceItems) {
            let p = state.products.find(x => x && x.id == item.prodId);
            if (!p) { alert('المنتج غير موجود'); return; }
            if (p.stock < item.qty) {
                alert('الكمية غير متوفرة\n' + p.name + '\nالمتوفر: ' + p.stock + '\nالمطلوب: ' + item.qty);
                return;
            }
            await atomicStockUpdate(item.prodId, item.qty, 'subtract');
            addTrackRecord(p.id, p.name, 'بيع فاتورة', -item.qty, `فاتورة #${currentInvNumber}`);
            currentProfit += ((item.price - item.cost) * item.qty);
        }

        // خصم الحسم بعد حساب الربح
        currentProfit -= discount;

        if (remaining > 0) {
            let c = state.clients.find(x => x && x.name === clientName);
            if (c) {
                const balanceBefore = c.balance || 0;
                c.balance = balanceBefore + remaining;
                if (!c.transactions) c.transactions = [];
                c.transactions.unshift({
                    id: transId,
                    type: 'invoice',
                    amount: remaining,
                    date: Date.now(),
                    note: 'فاتورة رقم ' + currentInvNumber,
                    balanceBefore: balanceBefore,
                    balanceAfter: c.balance
                });
                
                trackChange('clients', c.id, 'update', c);

                recordLedgerEntry('ذمم العملاء', remaining, 0, `فاتورة #${currentInvNumber}`, `عميل: ${clientName}`);
                recordLedgerEntry('إيرادات المبيعات', 0, remaining, `فاتورة #${currentInvNumber}`, `عميل: ${clientName}`);
            }
        }

        if (actualPaidAmount > 0) {
            updateSafe(curr, actualPaidAmount, 'add', 'فاتورة رقم ' + currentInvNumber);
            recordLedgerEntry('صندوق ' + currencyLabel(curr), actualPaidAmount, 0, `فاتورة #${currentInvNumber}`, `عميل: ${clientName}`);
            recordLedgerEntry('إيرادات المبيعات', 0, total, `فاتورة #${currentInvNumber}`, `عميل: ${clientName}`);
        }

        const now = Date.now();
        const newInvoice = {
            id: newId,
            transId: transId,
            number: currentInvNumber,
            date: new Date().toLocaleDateString('ar-EG'),
            timestamp: now,
            clientName: clientName,
            items: [...currentInvoiceItems],
            total: total,
            discount: discount,
            paid: paidUsd,
            actualPaid: actualPaidAmount,
            currency: curr,
            remaining: remaining,
            profit: currentProfit
        };
        state.invoices.unshift(newInvoice);
        
        trackChange('invoices', newId, editingInvoiceId ? 'update' : 'create', newInvoice);

        if (!editingInvoiceId) state.invoiceCount += 1;

        saveToLocal();
        if (navigator.onLine) {
    SyncManager.performDeltaSync();
}
        updateProductsUI();
        updateInvoicesListUI();
        calculateDashboard();
        editingInvoiceId = newId;
        document.getElementById('pos-title').innerText = `✏️ تعديل فاتورة رقم #${newInvoice.number}`;

        document.querySelectorAll('.invoice-table input').forEach(inp => { inp.nextElementSibling.innerText = inp.value;
            inp.nextElementSibling.style.display = ''; });
        setTimeout(() => { window.print(); }, 300);
    } catch (err) {
        state.products = JSON.parse(backupProducts);
        state.clients = JSON.parse(backupClients);
        state.safes = JSON.parse(backupSafes);
        alert("❌ حدث خطأ: " + err.message);
        console.error(err);
    }
}

// ===== إصلاح clearInvoiceManual: إعادة تعيين editingInvoiceId =====
function clearInvoiceManual() {
    currentInvoiceItems = [];
    editingInvoiceId = null;
    document.getElementById('pos-title').innerText = "إنشاء فاتورة جديدة";
    document.getElementById('inv-client-select').value = 'عام';
    document.getElementById('inv-paid-amount').value = 0;
    document.getElementById('inv-discount').value = 0;
    updateInvoiceClientName();
    renderInvoiceTable();
    updateLiveMetaBar();
}

async function deleteInvoice(id) {
    if (!confirm("حذف هذه الفاتورة نهائياً؟ سيتم استرجاع البضاعة ومسح الدين.")) return;
    if (!confirm("تأكيد نهائي: لا يمكن التراجع عن هذا الإجراء!")) return;
    
    const oldInvIndex = state.invoices.findIndex(i => i && i.id == id);
    if (oldInvIndex !== -1) {
        let oldInv = state.invoices[oldInvIndex];
        if (!oldInv) { throw new Error('OLD_INVOICE_NOT_FOUND'); }
        
        for (let oldItem of (oldInv.items || [])) {
            let p = state.products.find(x => x && x.id == oldItem.prodId);
            if (p) {
                p.stock += oldItem.qty;
                p.version = (p.version || 0) + 1;
                p._updatedAt = Date.now();
                trackChange('products', p.id, 'update', p);
                addTrackRecord(p.id, p.name, 'استرجاع', oldItem.qty, `إلغاء فاتورة #${oldInv.number}`);
            }
        }
        
        if (oldInv && Number(oldInv.remaining || 0) > 0) {
            let c = state.clients.find(x => x && x.name === oldInv.clientName);
            if (c) {
                c.balance = Math.max(0, Number(c.balance || 0) - Number(oldInv.remaining || 0));
                if (Array.isArray(c.transactions) && oldInv.transId) {
                    c.transactions = (c.transactions || []).filter(t => t && t.id !== oldInv.transId);
                }
                trackChange('clients', c.id, 'update', c);
            }
        }
        
        try {
            updateSafe(oldInv.currency || 'usd', (oldInv.actualPaid || oldInv.paid), 'subtract', `إلغاء فاتورة #${oldInv.number}`);
        } catch (err) { console.warn('Could not revert safe:', err); }
        
        state.invoices.splice(oldInvIndex, 1);
        trackChange('invoices', id, 'delete', { id });

        saveToLocal();
        if (navigator.onLine) {
    SyncManager.performDeltaSync();
}
        updateProductsUI();
        updateInvoicesListUI();
        calculateDashboard();
        addAdminLog("حذف فاتورة", `تم حذف الفاتورة رقم #${oldInv.number}`);
        alert("✅ تم حذف الفاتورة واسترجاع البضاعة بنجاح!");
    }
}

// ============================================================
// 15. INVOICES HISTORY
// ============================================================
let currentInvoicesPage = 1;
const INVOICES_PER_PAGE = 30;

function updateInvoicesListUI() {
    const list = document.getElementById('invoices-list');
    const pagination = document.getElementById('invoices-pagination');
    if (!list) return;

    const start = (currentInvoicesPage - 1) * INVOICES_PER_PAGE;
    const end = start + INVOICES_PER_PAGE;
    const paginated = state.invoices.slice(start, end);

    let html = '';
    paginated.forEach(inv => {
        if (!inv) return;
        let debtTag = inv.remaining > 0 ? `<span style="color:var(--danger-color);font-size:11px;">[باقي ${inv.remaining}$]</span>` : `<span style="color:var(--success-color);font-size:11px;">[خالص]</span>`;
        html += `<div class="data-list-item">
            <div><strong>فاتورة #${inv.number}</strong> <br><small>${inv.date} | ${inv.clientName}</small></div>
            <div style="text-align: left; display:flex; flex-direction:column; gap:5px; align-items:flex-end;">
                <span style="font-weight:bold;">${inv.total}$ ${debtTag}</span>
                <div style="display:flex; gap:5px;">
                    <button class="action-btn" style="background:var(--info-color); color:white; border:none;" onclick="printOldInvoice('${inv.id}')">🖨️ طباعة</button>
                    <button class="action-btn" style="background:var(--warning-color); color:white; border:none;" onclick="editOldInvoice('${inv.id}')">✏️ تعديل</button>
                    <button class="action-btn" style="background:var(--danger-color); color:white; border:none;" onclick="deleteInvoice('${inv.id}')">❌ إلغاء</button>
                </div>
            </div>
        </div>`;
    });
    list.innerHTML = html || '<p style="text-align:center; color:#64748b;">لا توجد فواتير</p>';

    let pagHtml = '';
    if (currentInvoicesPage > 1) pagHtml += `<button class="page-btn" onclick="changeInvoicesPage(-1)">السابق</button>`;
    if (end < state.invoices.length) pagHtml += `<button class="page-btn" onclick="changeInvoicesPage(1)">التالي</button>`;
    if (pagination) pagination.innerHTML = pagHtml;
}

function changeInvoicesPage(dir) {
    currentInvoicesPage += dir;
    updateInvoicesListUI();
}

function editOldInvoice(id) {
    const inv = state.invoices.find(i => i && i.id === id);
    if (!inv) return;
    editingInvoiceId = inv.id;
    currentInvoiceItems = JSON.parse(JSON.stringify(inv.items || []));
    document.getElementById('inv-client-select').value = inv.clientName || 'عام';
    document.getElementById('inv-paid-amount').value = inv.actualPaid || inv.paid || 0;
    document.getElementById('inv-discount').value = inv.discount || 0;
    document.getElementById('inv-currency').value = inv.currency || 'usd';
    
    updateInvoiceClientName();
    renderInvoiceTable();
    document.getElementById('pos-title').innerText = `✏️ تعديل فاتورة رقم #${inv.number}`;
    switchTab('pos');
}

function printOldInvoice(id) {
    const inv = state.invoices.find(i => i && i.id === id);
    if (!inv) return;
    
    const backupId = editingInvoiceId;
    const backupItems = JSON.parse(JSON.stringify(currentInvoiceItems));
    
    editingInvoiceId = inv.id;
    currentInvoiceItems = JSON.parse(JSON.stringify(inv.items || []));
    document.getElementById('inv-client-select').value = inv.clientName || 'عام';
    document.getElementById('inv-paid-amount').value = inv.actualPaid || inv.paid || 0;
    document.getElementById('inv-discount').value = inv.discount || 0;
    document.getElementById('inv-currency').value = inv.currency || 'usd';
    
    updateInvoiceClientName();
    renderInvoiceTable();
    document.getElementById('pos-title').innerText = `📄 طباعة فاتورة رقم #${inv.number}`;
    
    document.querySelectorAll('.invoice-table input').forEach(inp => { 
        inp.nextElementSibling.innerText = inp.value;
        inp.nextElementSibling.style.display = ''; 
    });
    
    document.getElementById('inv-date-time-box').innerText = `التاريخ: ${inv.date}`;
    document.getElementById('inv-id-display').innerText = inv.number;

    setTimeout(() => { 
        window.print(); 
        editingInvoiceId = backupId;
        currentInvoiceItems = backupItems;
        renderInvoiceTable();
        updateLiveMetaBar();
        if(!editingInvoiceId) clearInvoiceManual();
    }, 500);
}

// ============================================================
// 16. PRODUCTS
// ============================================================
let currentProductsPage = 1;
const PRODUCTS_PER_PAGE = 30;

function updateProductsUI() {
    const list = document.getElementById('products-list');
    const pagination = document.getElementById('products-pagination');
    const keyword = document.getElementById('prod-search') ? document.getElementById('prod-search').value.trim().toLowerCase() : "";
    if (!list) return;

    let filtered = state.products;
    if (keyword) {
        filtered = state.products.filter(p => p && p.name && (p.name.toLowerCase().includes(keyword) || (p.category && p.category.toLowerCase().includes(keyword))));
        currentProductsPage = 1;
    }

    const start = (currentProductsPage - 1) * PRODUCTS_PER_PAGE;
    const end = start + PRODUCTS_PER_PAGE;
    const paginated = filtered.slice(start, end);
    let html = '';
    paginated.forEach(p => {
        if (!p) return;
        const img = p.image ? `<img src="${p.image}" class="product-img-thumbnail">` : `<div class="product-img-thumbnail" style="line-height:50px; text-align:center; font-size:10px; background:#e2e8f0;">بدون</div>`;
        let alertTag = p.stock <= 3 ? `<span style="color:red; font-size:10px; font-weight:bold;">⚠️ منخفض (${p.stock})</span>` : '';
        html += `<div class="data-list-item"><div style="display:flex; align-items:center;">${img}<div style="margin-right:10px;"><strong>${p.name}</strong><br><small>${p.category} | متوفر: ${p.stock} ${alertTag} | v${p.version || 1}</small></div></div><div style="text-align: left;"><div style="display:flex; gap:4px; margin-bottom:5px; font-size:11px;"><span style="background:#e2e8f0; padding:2px 4px; border-radius:4px;">ش:${formatPrice(p.cost, 'usd')}</span><span style="background:#e2e8f0; padding:2px 4px; border-radius:4px;">ج:${formatPrice(p.wholesale, 'usd')}</span><span style="background:#e2e8f0; padding:2px 4px; border-radius:4px;">م:${formatPrice(p.retail, 'usd')}</span></div><div><button class="action-btn" style="background:#2563eb; color:white; border:none;" onclick="editProduct('${p.id}')">تعديل</button> <button class="action-btn" style="background:#ef4444; color:white; border:none;" onclick="deleteProduct('${p.id}')">❌</button></div></div></div>`;
    });
    list.innerHTML = html;

    let pagHtml = '';
    if (currentProductsPage > 1) pagHtml += `<button class="page-btn" onclick="changeProductsPage(-1)">السابق</button>`;
    if (end < filtered.length) pagHtml += `<button class="page-btn" onclick="changeProductsPage(1)">التالي</button>`;
    if (pagination) pagination.innerHTML = pagHtml;
}
const debouncedUpdateProducts = debounce(updateProductsUI, 250);

function changeProductsPage(dir) { currentProductsPage += dir; updateProductsUI(); }
// ============================================================
// دوال الأقسام وحماية الحذف وسجل النظام
// ============================================================
function addAdminLog(action, details) {
    const log = {
        id: generateUniqueID(),
        action: action,
        details: details,
        date: new Date().toLocaleString('ar-EG')
    };
    state.adminLogs.unshift(log);
    if (state.adminLogs.length > 500) state.adminLogs.length = 500;
    
    trackChange('adminLogs', log.id, 'create', log);
    saveToLocal();
    renderAdminLogs();
}

function renderAdminLogs() {
    const list = document.getElementById('admin-logs-list');
    if (!list) return;
    let html = '';
    state.adminLogs.slice(0, 50).forEach(log => {
        html += `<div style="padding:8px; border-bottom:1px solid #e2e8f0;">
            <strong style="color:var(--primary-color);">${log.action}</strong>
            <span style="float:left; font-size:11px; color:#64748b;">${log.date}</span>
            <div style="font-size:12px; margin-top:4px;">${log.details}</div>
        </div>`;
    });
    list.innerHTML = html || '<p style="text-align:center; color:#64748b;">لا توجد حركات مسجلة</p>';
}

function saveCategory() {
    const catNameInput = document.getElementById('cat-name');
    const catName = catNameInput.value.trim();
    
    if (!catName) return alert("يرجى إدخال اسم القسم");
    if (state.categories.includes(catName)) return alert("هذا القسم موجود مسبقاً!");

    state.categories.push(catName);
    saveToLocal();
    if (navigator.onLine) {
    SyncManager.performDeltaSync();
}
    updateCategoriesUI();
    catNameInput.value = '';
    addAdminLog("إضافة قسم", `تم إضافة قسم جديد: ${catName}`);
    alert("✅ تم إضافة القسم بنجاح");
}

function deleteCategory(catName) {
    const hasProducts = state.products.some(p => p && p.category === catName);
    if (hasProducts) {
        return alert("❌ لا يمكن حذف هذا القسم لأنه لا يزال يحتوي على قطع غيار نشطة. قم بحذف أو نقل القطع أولاً.");
    }

    if (!confirm(`هل أنت متأكد من حذف قسم "${catName}"؟`)) return;

    state.categories = state.categories.filter(c => c !== catName);
    saveToLocal();
    if (navigator.onLine) {
    SyncManager.performDeltaSync();
}
    updateCategoriesUI();
    addAdminLog("حذف قسم", `تم حذف قسم: ${catName}`);
}

function updateCategoriesUI() {
    const list = document.getElementById('categories-list');
    const prodCatSelect = document.getElementById('prod-category');
    const bulkCatSelect = document.getElementById('bulk-category');
    
    if (list) {
        let html = '';
        state.categories.forEach(cat => {
            html += `
            <div class="data-list-item">
                <strong>${cat}</strong>
                <button class="action-btn" style="background:var(--danger-color); color:white; border:none;" onclick="deleteCategory('${cat}')">🗑️ حذف</button>
            </div>`;
        });
        list.innerHTML = html;
    }

    let optionsHtml = '';
    state.categories.forEach(cat => { optionsHtml += `<option value="${cat}">${cat}</option>`; });
    
    if (prodCatSelect) prodCatSelect.innerHTML = optionsHtml;
    if (bulkCatSelect) bulkCatSelect.innerHTML = optionsHtml;
}

// ============================================================
// دوال إدارة المخزن وقطع الغيار
// ============================================================
let editingProductId = null;

function readNumberInputStrict(id, label, options = {}) {
    const el = document.getElementById(id);
    const raw = String(el && el.value !== undefined ? el.value : '').trim();
    const required = options.required !== false;
    const min = Number.isFinite(Number(options.min)) ? Number(options.min) : 0;
    if (!raw) {
        if (!required) return { ok: true, value: 0 };
        return { ok: false, error: `${label}: value is required` };
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return { ok: false, error: `${label}: invalid number` };
    if (n < min) return { ok: false, error: `${label}: must be ${min} or higher` };
    const value = options.integer ? Math.trunc(n) : roundMoney(n);
    return { ok: true, value };
}

function readProductFormValues() {
    const name = document.getElementById('prod-name').value.trim();
    const category = document.getElementById('prod-category').value;
    const checks = [
        readNumberInputStrict('prod-cost', 'Purchase price'),
        readNumberInputStrict('prod-wholesale', 'Wholesale price'),
        readNumberInputStrict('prod-retail', 'Retail price'),
        readNumberInputStrict('prod-stock', 'Stock', { integer: true })
    ];
    const errors = checks.filter(item => !item.ok).map(item => item.error);
    if (!name) errors.unshift('Product name is required');
    if (errors.length) return { ok: false, errors };
    return {
        ok: true,
        value: {
            name,
            category,
            cost: checks[0].value,
            wholesale: checks[1].value,
            retail: checks[2].value,
            stock: checks[3].value
        }
    };
}

async function uploadImageToCloudinary(imageFile) {
    const formData = new FormData();
    formData.append("file", imageFile);
    formData.append("upload_preset", "ABONIBAL");

    const response = await fetch(
        "https://api.cloudinary.com/v1_1/dlykkcche/image/upload",
        {
            method: "POST",
            body: formData
        }
    );

    if (!response.ok) {
        throw new Error("فشل رفع الصورة إلى Cloudinary");
    }

    const data = await response.json();
    return data.secure_url;
}

async function saveProduct() {
    const form = readProductFormValues();
    if (!form.ok) return alert(form.errors.join('\n'));
    const { name, category, cost, wholesale, retail, stock } = form.value;
    const imageFile = document.getElementById('prod-image').files[0];

    const btn = document.getElementById('save-prod-btn');
    const originalBtnText = btn.innerText;
    btn.disabled = true;

    try {
        let imageUrl = null;
        let pendingImageDataURL = null;

        if (imageFile) {
            if (navigator.onLine) {
                btn.innerText = "⏳ جاري رفع الصورة للسحابة...";
                imageUrl = await uploadImageToCloudinary(imageFile);
            } else {
                btn.innerText = "💾 حفظ محلياً مع صورة معلقة...";
                pendingImageDataURL = await fileToDataURL(imageFile);
            }
        }

        if (editingProductId) {
            const pIndex = state.products.findIndex(p => p.id === editingProductId);
            if (pIndex !== -1) {
                const oldStock = state.products[pIndex].stock;
                state.products[pIndex] = {
                    ...state.products[pIndex],
                    name, category, cost, wholesale, retail, stock,
                    image: imageUrl || state.products[pIndex].image || "",
                    imageUploadPending: Boolean(pendingImageDataURL),
                    version: (state.products[pIndex].version || 0) + 1,
                    _updatedAt: Date.now(),
                    _deviceId: DEVICE_ID
                };
                if (pendingImageDataURL) await queueImageUpload(editingProductId, pendingImageDataURL);
                trackChange('products', editingProductId, 'update', state.products[pIndex]);
                if (stock !== oldStock) {
                    addTrackRecord(editingProductId, name, 'تعديل', stock - oldStock, 'تعديل كمية/بيانات القطعة');
                }
                addAdminLog("تعديل قطعة", `تم تعديل بيانات: ${name}`);
            }
            editingProductId = null;
            document.getElementById('form-product-title').innerText = "إضافة قطعة واحدة";
            document.getElementById('cancel-edit-btn').style.display = 'none';
        } else {
            const newId = generateUniqueID();
            const newProduct = {
                id: newId, name, category, cost, wholesale, retail, stock,
                image: imageUrl || "",
                imageUploadPending: Boolean(pendingImageDataURL),
                version: 1,
                _updatedAt: Date.now(),
                _deviceId: DEVICE_ID
            };
            const existingIndex = findProductIndexByIdentity(newProduct, newId);
            if (existingIndex >= 0) {
                const existing = state.products[existingIndex];
                const oldStock = Number(existing.stock) || 0;
                const updatedProduct = {
                    ...existing,
                    ...newProduct,
                    id: existing.id,
                    image: imageUrl || existing.image || "",
                    version: (Number(existing.version) || 0) + 1,
                    _updatedAt: Date.now(),
                    _deviceId: DEVICE_ID
                };
                state.products[existingIndex] = updatedProduct;
                if (pendingImageDataURL) await queueImageUpload(existing.id, pendingImageDataURL);
                trackChange('products', existing.id, 'update', updatedProduct);
                if (stock !== oldStock) addTrackRecord(existing.id, name, 'تعديل', stock - oldStock, 'تحديث منتج موجود بنفس الهوية');
                addAdminLog("تحديث قطعة", `تم تحديث قطعة موجودة بنفس الهوية: ${name}`);
            } else {
                if (pendingImageDataURL) await queueImageUpload(newId, pendingImageDataURL);
                state.products.unshift(newProduct);
                trackChange('products', newId, 'create', newProduct);
                addTrackRecord(newId, name, 'إضافة', stock, 'إضافة قطعة جديدة للمخزن');
                addAdminLog("إضافة قطعة", `تم إضافة قطعة جديدة: ${name}`);
            }
        }

        await saveToLocal();
        if (navigator.onLine) SyncManager.performDeltaSync();
        updateProductsUI();
        calculateDashboard();

        document.getElementById('prod-name').value = '';
        document.getElementById('prod-cost').value = '';
        document.getElementById('prod-wholesale').value = '';
        document.getElementById('prod-retail').value = '';
        document.getElementById('prod-stock').value = '10';
        document.getElementById('prod-image').value = '';

        alert(pendingImageDataURL ? "✅ تم الحفظ محلياً، وستُرفع الصورة تلقائياً عند عودة الإنترنت." : "✅ تم الحفظ بنجاح!");
    } catch (error) {
        console.error("فشل حفظ المنتج:", error);
        alert("❌ حدث خطأ أثناء الحفظ: " + error.message);
    } finally {
        btn.innerText = originalBtnText || "💾 حفظ القطعة";
        btn.disabled = false;
    }
}

function editProduct(id) {
    const prod = state.products.find(p => p.id === id);
    if (!prod) return;
    editingProductId = id;
    document.getElementById('prod-name').value = prod.name;
    document.getElementById('prod-category').value = prod.category;
    document.getElementById('prod-cost').value = parseFloat(Number(prod.cost || 0).toFixed(2));
    document.getElementById('prod-wholesale').value = parseFloat(Number(prod.wholesale || 0).toFixed(2));
    document.getElementById('prod-retail').value = parseFloat(Number(prod.retail || 0).toFixed(2));
    document.getElementById('prod-stock').value = prod.stock;
    
    document.getElementById('form-product-title').innerText = `✏️ تعديل: ${prod.name}`;
    document.getElementById('cancel-edit-btn').style.display = 'inline-block';
    document.getElementById('save-prod-btn').innerText = "💾 تحديث البيانات";
    window.scrollTo(0, document.getElementById('product-form-container').offsetTop - 100);
}

function cancelEditProduct() {
    editingProductId = null;
    document.getElementById('prod-name').value = '';
    document.getElementById('prod-cost').value = '';
    document.getElementById('prod-wholesale').value = '';
    document.getElementById('prod-retail').value = '';
    document.getElementById('prod-stock').value = '10';
    document.getElementById('form-product-title').innerText = "إضافة قطعة واحدة";
    document.getElementById('cancel-edit-btn').style.display = 'none';
    document.getElementById('save-prod-btn').innerText = "💾 حفظ القطعة";
}

async function deleteProduct(id) {
    if (!confirm("هل أنت متأكد من حذف هذه القطعة نهائياً؟")) return;
    const pIndex = state.products.findIndex(p => p.id === id);
    if (pIndex !== -1) {
        const prod = state.products[pIndex];
        const prodName = prod.name;
        
        state.products.splice(pIndex, 1);
        trackChange('products', id, 'delete', { id });

await saveToLocal();

updateProductsUI();
        calculateDashboard();
        
        if (navigator.onLine) {
    SyncManager.performDeltaSync();
}
        addAdminLog("حذف قطعة", `تم حذف القطعة: ${prodName}`);
    }
}

// ============================================================
// دوال العملاء والموردين (الديون)
// ============================================================
function saveClient() {
    const name = document.getElementById('client-name').value.trim();
    const phone = document.getElementById('client-phone').value.trim();
    if (!name) return alert("الرجاء إدخال اسم العميل");
    if (state.clients.find(c => c && c.name === name)) return alert("العميل موجود مسبقاً");

    const newClient = {
        id: generateUniqueID(),
        name,
        phone,
        balance: 0,
        transactions: []
    };
    
    state.clients.unshift(newClient);
    trackChange('clients', newClient.id, 'create', newClient);
    
    saveToLocal();

if (navigator.onLine) {
    SyncManager.performDeltaSync();
}

updateClientsUI();
    document.getElementById('client-name').value = '';
    document.getElementById('client-phone').value = '';
    addAdminLog("إضافة عميل", `تم إضافة العميل: ${name}`);
    alert("✅ تم حفظ العميل");
}

function updateClientsUI() {
    const list = document.getElementById('clients-list');
    const retSelect = document.getElementById('ret-client-select');
    const invSelect = document.getElementById('inv-client-select');
    
    let needsSave = false;

    if (list) {
        let html = '';
        state.clients.forEach(c => {
            if(!c) return;

            if (!c.id || c.id === 'undefined' || c.id === null) {
                c.id = generateUniqueID();
                needsSave = true;
            }

            html += `<div class="data-list-item">
                <div><strong>${c.name}</strong><br><small>${c.phone || 'لا يوجد رقم'}</small></div>
                <div style="text-align:left; display:flex; flex-direction:column; gap:5px; align-items:flex-end;">
                    <span style="color:var(--danger-color); font-weight:bold; display:block;">${(c.balance || 0).toFixed(2)} $</span>
                    <div style="display:flex; gap:5px;">
                        <button class="action-btn" style="background:var(--info-color); color:white; border:none;" onclick="showClientStatement('${c.id}')">كشف حساب</button>
                        <button class="action-btn" style="background:var(--warning-color); color:white; border:none;" onclick="editClient('${c.id}')">✏️</button>
                        <button class="action-btn" style="background:var(--danger-color); color:white; border:none;" onclick="deleteClient('${c.id}')">🗑️</button>
                    </div>
                </div>
            </div>`;
        });
        list.innerHTML = html || '<p style="text-align:center; color:#64748b;">لا يوجد عملاء</p>';
    }

    if (needsSave) {
        saveToLocal();
    }

    let optionsHtml = '<option value="">-- اختر العميل --</option>';
    let invOptionsHtml = '<option value="عام">عميل عام / نقدي</option>';
    state.clients.forEach(c => { 
        if(c && c.name) {
            optionsHtml += `<option value="${c.name}">${c.name}</option>`; 
            invOptionsHtml += `<option value="${c.name}">${c.name}</option>`;
        }
    });
    if (retSelect) retSelect.innerHTML = optionsHtml;
    if (invSelect) invSelect.innerHTML = invOptionsHtml;
}

function showClientStatement(id) {
    const client = state.clients.find(c => c && String(c.id) === String(id));
    if(!client) return alert("❌ بيانات هذا العميل تالفة، يرجى تحديث الصفحة.");
    
    const content = document.getElementById('client-statement-content');
    let html = `<h3 style="margin-bottom:10px; color:var(--primary-color);">العميل: ${client.name}</h3>`;
    html += `<p style="margin-bottom:15px; font-weight:bold;">الرصيد المطلوب: <span style="color:var(--danger-color);">${(client.balance || 0).toFixed(2)} $</span></p>`;
    html += `<div style="display:flex; gap:5px; margin-bottom:15px; flex-wrap:wrap;">
        <input type="number" id="pay-debt-amount" placeholder="المبلغ المقبوض" style="flex:1; min-width:120px;">
        <select id="pay-debt-currency" style="width:100px; padding:10px; border-radius:10px; border:1px solid #cbd5e1;">
            <option value="usd">$ دولار</option>
            <option value="try">₺ تركي</option>
            <option value="syp">ل.س سوري</option>
        </select>
        <button onclick="payClientDebt('${client.id}')" style="background:var(--success-color); width:auto; padding:0 15px;">تسديد دفعة</button>
    </div>`;
    html += `<table style="width:100%; border-collapse:collapse; font-size:12px; text-align:center;" border="1">
        <tr style="background:#f1f5f9;"><th>التاريخ</th><th>البيان</th><th>المبلغ</th><th>الرصيد ($)</th></tr>`;
    
    (client.transactions || []).forEach(t => {
        let color = t.type === 'payment' ? 'green' : 'red';
        let sign = t.type === 'payment' ? '-' : '+';
        let displayAmount = t.type === 'payment' && t.currencyPaid && t.currencyPaid !== 'usd' 
            ? `${t.actualAmountPaid} ${currencyLabel(t.currencyPaid)} (≈${Number(t.amount).toFixed(2)}$)` 
            : `${Number(t.amount).toFixed(2)}$`;

        html += `<tr>
            <td style="padding:5px;">${new Date(t.date).toLocaleDateString('ar-EG')}</td>
            <td style="padding:5px;">${t.note || ''}</td>
            <td style="padding:5px; color:${color};" dir="ltr">${sign} ${displayAmount}</td>
            <td style="padding:5px; font-weight:bold;">${Number(t.balanceAfter).toFixed(2)}</td>
        </tr>`;
    });
    html += `</table>`;
    content.innerHTML = html;
    document.getElementById('client-statement-modal').style.display = 'flex';
}

function closeClientStatement() {
    document.getElementById('client-statement-modal').style.display = 'none';
}

function payClientDebt(id) {
    const amount = parseFloat(document.getElementById('pay-debt-amount').value);
    const currency = document.getElementById('pay-debt-currency').value;

    if(!amount || amount <= 0) return alert("أدخل مبلغ صحيح");
    const client = state.clients.find(c => c && String(c.id) === String(id));
    if(!client) return;

    let usdEq = amount;
    if (currency === 'try' && state.rates.try > 0) usdEq = amount / state.rates.try;
    else if (currency === 'syp' && state.rates.syp > 0) usdEq = amount / state.rates.syp;
    else if (currency !== 'usd') {
        return alert("⚠️ الرجاء ضبط أسعار الصرف من قسم الصرافة أولاً!");
    }

    if (usdEq <= 0 && currency !== 'usd') return alert("الرجاء ضبط أسعار الصرف من قسم الصرافة أولاً!");

    const balanceBefore = client.balance || 0;
    client.balance = Math.max(0, balanceBefore - usdEq);
    
    if(!client.transactions) client.transactions = [];
    client.transactions.unshift({
        id: generateUniqueID(),
        type: 'payment',
        amount: usdEq,
        currencyPaid: currency,
        actualAmountPaid: amount,
        date: Date.now(),
        note: `دفعة نقدية (${amount} ${currency})`,
        balanceBefore: balanceBefore,
        balanceAfter: client.balance
    });

    updateSafe(currency, amount, 'add', `دفعة من العميل: ${client.name}`);
    recordLedgerEntry(`صندوق ${currencyLabel(currency)}`, usdEq, 0, 'سند قبض', `دفعة من العميل ${client.name}`);
    recordLedgerEntry('ذمم العملاء', 0, usdEq, 'سند قبض', `دفعة من العميل ${client.name}`);

    trackChange('clients', client.id, 'update', client);

    saveToLocal();
    updateClientsUI();
    calculateDashboard();
    showClientStatement(id);
    addAdminLog("تسديد دفعة", `تم استلام ${amount} ${currency} من العميل ${client.name}`);
    alert("✅ تم تسجيل الدفعة بنجاح");
}

function editClient(id) {
    const client = state.clients.find(c => c && String(c.id) === String(id));
    if (!client) return alert("❌ بيانات هذا العميل غير متوفرة.");
    
    const newName = prompt("أدخل اسم العميل الجديد:", client.name);
    if (!newName) return;
    const newPhone = prompt("أدخل رقم الهاتف الجديد:", client.phone || '');

    client.name = newName.trim();
    client.phone = newPhone.trim();

    trackChange('clients', client.id, 'update', client);
    saveToLocal();
    if (navigator.onLine) {
    SyncManager.performDeltaSync();
}
    updateClientsUI();
    addAdminLog("تعديل عميل", `تم تعديل بيانات العميل: ${client.name}`);
}

function deleteClient(id) {
    const client = state.clients.find(c => c && String(c.id) === String(id));
    if (!client) return alert("❌ لم يتم العثور على العميل، قد يكون محذوفاً مسبقاً.");
    
    if (client.balance > 0) return alert("❌ لا يمكن حذف عميل عليه ديون! قم بتصفية الحساب أولاً.");
    if (!confirm(`هل أنت متأكد من حذف العميل "${client.name}" نهائياً؟`)) return;

    state.clients = state.clients.filter(c => String(c.id) !== String(id));
    trackChange('clients', id, 'delete', { id });
    saveToLocal();

if (navigator.onLine) {
    SyncManager.performDeltaSync();
}

updateClientsUI();
    addAdminLog("حذف عميل", `تم حذف العميل: ${client.name}`);
}

function saveSupplier() {
    const name = document.getElementById('supplier-name').value.trim();
    const phone = document.getElementById('supplier-phone').value.trim();
    if (!name) return alert("الرجاء إدخال اسم التاجر");
    if (state.suppliers.find(s => s && s.name === name)) return alert("التاجر موجود مسبقاً");

    const newSupplier = {
        id: generateUniqueID(),
        name,
        phone,
        balance: 0,
        transactions: []
    };

    state.suppliers.unshift(newSupplier);
    trackChange('suppliers', newSupplier.id, 'create', newSupplier);

    saveToLocal();
   if (navigator.onLine) {
    SyncManager.performDeltaSync();
} 
    updateSuppliersUI();
    document.getElementById('supplier-name').value = '';
    document.getElementById('supplier-phone').value = '';
    addAdminLog("إضافة مورد", `تم إضافة المورد: ${name}`);
    alert("✅ تم حفظ التاجر");
}

function updateSuppliersUI() {
    const list = document.getElementById('suppliers-list');
    if (!list) return;
    let html = '';
    state.suppliers.forEach(s => {
        if(!s) return;
        html += `<div class="data-list-item">
            <div><strong>${s.name}</strong><br><small>${s.phone || 'لا يوجد رقم'}</small></div>
            <div style="text-align:left; display:flex; flex-direction:column; gap:5px; align-items:flex-end;">
                <span style="color:var(--danger-color); font-weight:bold; display:block;">${(s.balance || 0).toFixed(2)} $</span>
                <div style="display:flex; gap:5px;">
                    <button class="action-btn" style="background:var(--warning-color); color:white; border:none;" onclick="showSupplierStatement('${s.id}')">كشف حساب</button>
                    <button class="action-btn" style="background:var(--info-color); color:white; border:none;" onclick="editSupplier('${s.id}')">✏️</button>
                    <button class="action-btn" style="background:var(--danger-color); color:white; border:none;" onclick="deleteSupplier('${s.id}')">🗑️</button>
                </div>
            </div>
        </div>`;
    });
    list.innerHTML = html || '<p style="text-align:center; color:#64748b;">لا يوجد موردين</p>';
}

function showSupplierStatement(id) {
    const supplier = state.suppliers.find(s => s && s.id === id);
    if(!supplier) return;
    const content = document.getElementById('supplier-statement-content');
    let html = `<h3 style="margin-bottom:10px; color:var(--primary-color);">التاجر: ${supplier.name}</h3>`;
    html += `<p style="margin-bottom:15px; font-weight:bold;">الديون المستحقة له: <span style="color:var(--danger-color);">${(supplier.balance || 0).toFixed(2)} $</span></p>`;
    
    html += `<div style="display:flex; gap:5px; margin-bottom:10px; flex-wrap:wrap; background:#f1f5f9; padding:10px; border-radius:8px;">
        <input type="number" id="add-sup-debt-amount" placeholder="قيمة البضاعة/الدين ($)" style="flex:1; min-width:120px;">
        <button onclick="addSupplierDebt('${supplier.id}')" style="background:var(--danger-color); width:auto; padding:0 15px;">تسجيل التزام (دين)</button>
    </div>`;

    html += `<div style="display:flex; gap:5px; margin-bottom:15px; flex-wrap:wrap; background:#e0f2fe; padding:10px; border-radius:8px;">
        <input type="number" id="pay-sup-amount" placeholder="المبلغ المدفوع للتاجر" style="flex:1; min-width:120px;">
        <select id="pay-sup-currency" style="width:100px; padding:10px; border-radius:10px; border:1px solid #cbd5e1;">
            <option value="usd">$ دولار</option>
            <option value="try">₺ تركي</option>
            <option value="syp">ل.س سوري</option>
        </select>
        <button onclick="paySupplierDebt('${supplier.id}')" style="background:var(--success-color); width:auto; padding:0 15px;">تسديد دفعة للتاجر</button>
    </div>`;

    html += `<table style="width:100%; border-collapse:collapse; font-size:12px; text-align:center;" border="1">
        <tr style="background:#f1f5f9;"><th>التاريخ</th><th>البيان</th><th>المبلغ</th><th>الرصيد ($)</th></tr>`;
    
    (supplier.transactions || []).forEach(t => {
        let color = t.type === 'payment' ? 'green' : 'red';
        let sign = t.type === 'payment' ? '-' : '+';
        let displayAmount = t.type === 'payment' && t.currencyPaid && t.currencyPaid !== 'usd' 
            ? `${t.actualAmountPaid} ${currencyLabel(t.currencyPaid)} (≈${Number(t.amount).toFixed(2)}$)` 
            : `${Number(t.amount).toFixed(2)}$`;

        html += `<tr>
            <td style="padding:5px;">${new Date(t.date).toLocaleDateString('ar-EG')}</td>
            <td style="padding:5px;">${t.note || ''}</td>
            <td style="padding:5px; color:${color};" dir="ltr">${sign} ${displayAmount}</td>
            <td style="padding:5px; font-weight:bold;">${Number(t.balanceAfter).toFixed(2)}</td>
        </tr>`;
    });
    html += `</table>`;
    content.innerHTML = html;
    document.getElementById('supplier-statement-modal').style.display = 'flex';
}

function closeSupplierStatement() {
    document.getElementById('supplier-statement-modal').style.display = 'none';
}

function addSupplierDebt(id) {
    const amount = parseFloat(document.getElementById('add-sup-debt-amount').value);
    if(!amount || amount <= 0) return alert("أدخل مبلغ صحيح");
    
    const supplier = state.suppliers.find(s => s && s.id === id);
    if(!supplier) return;

    const balanceBefore = supplier.balance || 0;
    supplier.balance = balanceBefore + amount;

    if(!supplier.transactions) supplier.transactions = [];
    supplier.transactions.unshift({
        id: generateUniqueID(),
        type: 'debt',
        amount: amount,
        date: Date.now(),
        note: `تسجيل بضاعة/دين بالدولار`,
        balanceBefore: balanceBefore,
        balanceAfter: supplier.balance
    });

    recordLedgerEntry('المشتريات', amount, 0, 'بضاعة', `من التاجر ${supplier.name}`);
    recordLedgerEntry('ذمم التجار', 0, amount, 'بضاعة', `إلى التاجر ${supplier.name}`);

    trackChange('suppliers', supplier.id, 'update', supplier);
    saveToLocal();
    updateSuppliersUI();
    calculateDashboard();
    showSupplierStatement(id);
    addAdminLog("دين تاجر", `تم إضافة دين بقيمة ${amount}$ للتاجر ${supplier.name}`);
}

function paySupplierDebt(id) {
    const amount = parseFloat(document.getElementById('pay-sup-amount').value);
    const currency = document.getElementById('pay-sup-currency').value;

    if(!amount || amount <= 0) return alert("أدخل مبلغ صحيح");
    const supplier = state.suppliers.find(s => s && s.id === id);
    if(!supplier) return;

    let usdEq = amount;
    if (currency === 'try' && state.rates.try > 0) usdEq = amount / state.rates.try;
    else if (currency === 'syp' && state.rates.syp > 0) usdEq = amount / state.rates.syp;
    else if (currency !== 'usd') {
        return alert("⚠️ الرجاء ضبط أسعار الصرف من قسم الصرافة أولاً!");
    }

    if (usdEq <= 0 && currency !== 'usd') return alert("الرجاء ضبط أسعار الصرف من قسم الصرافة أولاً!");

    try {
        updateSafe(currency, amount, 'subtract', `تسديد للتاجر: ${supplier.name}`);
    } catch (err) {
        return alert("❌ " + err.message);
    }

    const balanceBefore = supplier.balance || 0;
    supplier.balance = Math.max(0, balanceBefore - usdEq);
    
    if(!supplier.transactions) supplier.transactions = [];
    supplier.transactions.unshift({
        id: generateUniqueID(),
        type: 'payment',
        amount: usdEq,
        currencyPaid: currency,
        actualAmountPaid: amount,
        date: Date.now(),
        note: `تسديد نقدي (${amount} ${currency})`,
        balanceBefore: balanceBefore,
        balanceAfter: supplier.balance
    });

    recordLedgerEntry('ذمم التجار', usdEq, 0, 'سند صرف', `تسديد للتاجر ${supplier.name}`);
    recordLedgerEntry(`صندوق ${currencyLabel(currency)}`, 0, usdEq, 'سند صرف', `تسديد للتاجر ${supplier.name}`);

    trackChange('suppliers', supplier.id, 'update', supplier);
    
    saveToLocal();
    updateSuppliersUI();
    calculateDashboard();
    showSupplierStatement(id);
    addAdminLog("تسديد تاجر", `تم تسديد ${amount} ${currency} للتاجر ${supplier.name}`);
    alert("✅ تم تسجيل الدفعة للتاجر بنجاح");
}

function editSupplier(id) {
    const supplier = state.suppliers.find(s => s && s.id === id);
    if (!supplier) return;
    const newName = prompt("أدخل اسم التاجر الجديد:", supplier.name);
    if (!newName) return;
    const newPhone = prompt("أدخل رقم الهاتف الجديد:", supplier.phone || '');

    supplier.name = newName.trim();
    supplier.phone = newPhone.trim();

    trackChange('suppliers', supplier.id, 'update', supplier);
    saveToLocal();
    if (navigator.onLine) {
    SyncManager.performDeltaSync();
}
    updateSuppliersUI();
    addAdminLog("تعديل مورد", `تم تعديل بيانات المورد: ${supplier.name}`);
}

function deleteSupplier(id) {
    const supplier = state.suppliers.find(s => s && s.id === id);
    if (!supplier) return;
    if (supplier.balance > 0) return alert("❌ لا يمكن حذف تاجر له ديون! قم بتصفية الحساب أولاً.");
    if (!confirm(`هل أنت متأكد من حذف التاجر ${supplier.name} نهائياً؟`)) return;

    state.suppliers = state.suppliers.filter(s => s.id !== id);
    trackChange('suppliers', id, 'delete', { id });
    saveToLocal();
    if (navigator.onLine) {
    SyncManager.performDeltaSync();
}
    updateSuppliersUI();
    addAdminLog("حذف مورد", `تم حذف التاجر: ${supplier.name}`);
}

// ============================================================
// دوال المصاريف وحسابات الشركاء
// ============================================================
function saveExpense() {
    const title = document.getElementById('exp-title').value.trim();
    const amount = parseFloat(document.getElementById('exp-amount').value);
    const currency = document.getElementById('exp-currency').value;
    
    if (!title || !amount || amount <= 0) return alert("يرجى إدخال البيان والمبلغ الصحيح");

    let usdEq = amount;
    if (currency === 'try' && state.rates.try > 0) usdEq = amount / state.rates.try;
    if (currency === 'syp' && state.rates.syp > 0) usdEq = amount / state.rates.syp;

    try {
        updateSafe(currency, amount, 'subtract', `مصروف تشغيلي: ${title}`);
    } catch (err) {
        return alert(err.message);
    }

    recordLedgerEntry('مصاريف تشغيلية', usdEq, 0, 'مصروف', title);
    recordLedgerEntry(`صندوق ${currencyLabel(currency)}`, 0, usdEq, 'مصروف', title);

    const newId = generateUniqueID();
    const newExpense = {
        id: newId,
        title,
        amount,
        currency,
        usdEquivalent: usdEq,
        date: new Date().toLocaleString('ar-EG')
    };
    state.expenses.unshift(newExpense);
    
    trackChange('expenses', newId, 'create', newExpense);

    saveToLocal();
    if (navigator.onLine) {
    SyncManager.performDeltaSync();
}
    updateExpensesUI();
    calculateDashboard();
    
    document.getElementById('exp-title').value = '';
    document.getElementById('exp-amount').value = '';
    addAdminLog("تسجيل مصروف", `تم تسجيل مصروف: ${title} بقيمة ${amount} ${currency}`);
    alert("✅ تم تسجيل المصروف");
}

function deleteExpense(id) {
    const idx = state.expenses.findIndex(e => e && String(e.id) === String(id));
    if (idx === -1) return;
    const exp = state.expenses[idx];
    if (!confirm(`هل تريد حذف المصروف "${exp.title || ''}"؟ سيتم إرجاع المبلغ إلى الصندوق.`)) return;

    const currency = currencyCode(exp.currency, 'usd');
    const amount = Number(exp.amount || 0);
    const usdEq = Number(exp.usdEquivalent || 0);

    try {
        if (amount > 0) updateSafe(currency, amount, 'add', `استرجاع حذف مصروف: ${exp.title || ''}`);
    } catch (err) {
        return alert('تعذر حذف المصروف: ' + err.message);
    }

    if (usdEq > 0) {
        recordLedgerEntry(`صندوق ${currencyLabel(currency)}`, usdEq, 0, 'حذف مصروف', exp.title || '');
        recordLedgerEntry('مصاريف تشغيلية', 0, usdEq, 'حذف مصروف', exp.title || '');
    }

    state.expenses.splice(idx, 1);
    trackChange('expenses', exp.id, 'delete', { id: exp.id });
    syncAfterLocalMutation();
    updateExpensesUI();
    calculateDashboard();
    addAdminLog('حذف مصروف', `تم حذف المصروف: ${exp.title || ''}`);
}

function updateExpensesUI() {
    const list = document.getElementById('expenses-list');
    if (!list) return;
    let html = '';
    state.expenses = forceArray(state.expenses).map(e => ({
        ...e,
        id: e && e.id ? e.id : generateUniqueID(),
        title: e && e.title ? e.title : 'مصروف',
        currency: currencyCode(e && e.currency, 'usd'),
        amount: Number(e && e.amount) || 0,
        usdEquivalent: Number(e && e.usdEquivalent) || 0,
        date: e && e.date ? e.date : ''
    }));
    state.expenses.forEach(e => {
        if(!e) return;
        html += `<div class="data-list-item">
            <div><strong>${e.title || 'مصروف'}</strong><br><small>${e.date || ''}</small><br><small style="color:#64748b;">${formatUsdEquivalent(e.usdEquivalent)}</small></div>
            <div style="text-align:left; display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
                <span style="color:var(--danger-color); font-weight:bold;" dir="ltr">${formatCurrencyAmount(e.amount, e.currency, '-')}</span>
                <button class="action-btn" style="background:var(--danger-color); color:white; border:none;" onclick="deleteExpense('${e.id}')">❌ حذف</button>
            </div>
        </div>`;
    });
    list.innerHTML = html || '<p style="text-align:center; color:#64748b;">لا توجد مصاريف</p>';
}

function savePartnerWithdrawal() {
    const partner = document.getElementById('partner-name').value;
    const note = document.getElementById('partner-note').value.trim();
    const amount = parseFloat(document.getElementById('partner-amount').value);
    const currency = document.getElementById('partner-currency').value;

    if (!amount || amount <= 0) return alert("أدخل مبلغ صحيح");

    let usdEq = amount;
    if (currency === 'try' && state.rates.try > 0) usdEq = amount / state.rates.try;
    if (currency === 'syp' && state.rates.syp > 0) usdEq = amount / state.rates.syp;

    try {
        updateSafe(currency, amount, 'subtract', `سحب شريك (${partner}): ${note}`);
    } catch (err) {
        return alert(err.message);
    }

    recordLedgerEntry(`جاري الشريك ${partner}`, usdEq, 0, 'سحب شريك', note);
    recordLedgerEntry(`صندوق ${currencyLabel(currency)}`, 0, usdEq, 'سحب شريك', note);

    const newId = generateUniqueID();
    const newWithdrawal = {
        id: newId,
        partner,
        note,
        amount,
        currency,
        usdEquivalent: usdEq,
        date: new Date().toLocaleString('ar-EG')
    };
    state.partnerWithdrawals.unshift(newWithdrawal);
    
    trackChange('partnerWithdrawals', newId, 'create', newWithdrawal);

    saveToLocal();

if (navigator.onLine) {
    SyncManager.performDeltaSync();
}
    
    updatePartnersUI();
    
    document.getElementById('partner-note').value = '';
    document.getElementById('partner-amount').value = '';
    addAdminLog("سحب شريك", `سحب ${partner} مبلغ ${amount} ${currency}`);
    alert("✅ تم تسجيل السحب");
}

function saveCapitalRecord() {
    const partner = document.getElementById('capital-name').value;
    const note = document.getElementById('capital-note').value.trim();
    const amount = parseFloat(document.getElementById('capital-amount').value);
    const currency = document.getElementById('capital-currency').value;

    if (!amount || amount <= 0) return alert("أدخل مبلغ صحيح");

    let usdEq = amount;
    if (currency === 'try' && state.rates.try > 0) usdEq = amount / state.rates.try;
    if (currency === 'syp' && state.rates.syp > 0) usdEq = amount / state.rates.syp;

    updateSafe(currency, amount, 'add', `رأس مال (${partner}): ${note}`);
    
    recordLedgerEntry(`صندوق ${currencyLabel(currency)}`, usdEq, 0, 'إضافة رأس مال', note);
    recordLedgerEntry(`رأس مال ${partner}`, 0, usdEq, 'إضافة رأس مال', note);

    const newId = generateUniqueID();
    const newCapital = {
        id: newId,
        partner,
        note,
        amount,
        currency,
        usdEquivalent: usdEq,
        date: new Date().toLocaleString('ar-EG')
    };
    state.capitalRecords.unshift(newCapital);
    
    trackChange('capitalRecords', newId, 'create', newCapital);

    saveToLocal();
    if (navigator.onLine) {
    SyncManager.performDeltaSync();
}
    updatePartnersUI();
    
    document.getElementById('capital-note').value = '';
    document.getElementById('capital-amount').value = '';
    addAdminLog("رأس مال", `إضافة رأس مال من ${partner} بقيمة ${amount} ${currency}`);
    alert("✅ تم إضافة رأس المال");
}

function deletePartnerWithdrawal(id) {
    const idx = state.partnerWithdrawals.findIndex(w => w && String(w.id) === String(id));
    if (idx === -1) return;
    const w = state.partnerWithdrawals[idx];
    if (!confirm(`هل تريد حذف سحب الشريك ${w.partner || ''}؟ سيتم إرجاع المبلغ إلى الصندوق.`)) return;

    const currency = currencyCode(w.currency, 'usd');
    const amount = Number(w.amount || 0);
    const usdEq = Number(w.usdEquivalent || 0);

    try {
        if (amount > 0) updateSafe(currency, amount, 'add', `استرجاع حذف سحب شريك (${w.partner || ''})`);
    } catch (err) {
        return alert('تعذر حذف السحب: ' + err.message);
    }

    if (usdEq > 0) {
        recordLedgerEntry(`صندوق ${currencyLabel(currency)}`, usdEq, 0, 'حذف سحب شريك', w.note || '');
        recordLedgerEntry(`جاري الشريك ${w.partner || ''}`, 0, usdEq, 'حذف سحب شريك', w.note || '');
    }

    state.partnerWithdrawals.splice(idx, 1);
    trackChange('partnerWithdrawals', w.id, 'delete', { id: w.id });
    syncAfterLocalMutation();
    updatePartnersUI();
    calculateDashboard();
    addAdminLog('حذف سحب شريك', `تم حذف سحب ${w.partner || ''}`);
}

function deleteCapitalRecord(id) {
    const idx = state.capitalRecords.findIndex(c => c && String(c.id) === String(id));
    if (idx === -1) return;
    const c = state.capitalRecords[idx];
    if (!confirm(`هل تريد حذف إضافة رأس المال من ${c.partner || ''}؟ سيتم خصم المبلغ من الصندوق.`)) return;

    const currency = currencyCode(c.currency, 'usd');
    const amount = Number(c.amount || 0);
    const usdEq = Number(c.usdEquivalent || 0);

    try {
        if (amount > 0) updateSafe(currency, amount, 'subtract', `حذف رأس مال (${c.partner || ''})`);
    } catch (err) {
        return alert('تعذر حذف رأس المال: ' + err.message);
    }

    if (usdEq > 0) {
        recordLedgerEntry(`رأس مال ${c.partner || ''}`, usdEq, 0, 'حذف رأس مال', c.note || '');
        recordLedgerEntry(`صندوق ${currencyLabel(currency)}`, 0, usdEq, 'حذف رأس مال', c.note || '');
    }

    state.capitalRecords.splice(idx, 1);
    trackChange('capitalRecords', c.id, 'delete', { id: c.id });
    syncAfterLocalMutation();
    updatePartnersUI();
    calculateDashboard();
    addAdminLog('حذف رأس مال', `تم حذف رأس مال ${c.partner || ''}`);
}

function updatePartnersUI() {
    const list = document.getElementById('partners-list');
    const capList = document.getElementById('capital-list');
    
    let totalAbuNibal = 0;
    let totalAbuAbdo = 0;

    if (list) {
        let html = '';
        state.partnerWithdrawals = forceArray(state.partnerWithdrawals).map(w => ({
            ...w,
            id: w && w.id ? w.id : generateUniqueID(),
            partner: w && w.partner ? w.partner : '',
            note: w && w.note ? w.note : '',
            amount: Number(w && w.amount) || 0,
            currency: currencyCode(w && w.currency, 'usd'),
            usdEquivalent: Number(w && w.usdEquivalent) || 0,
            date: w && w.date ? w.date : ''
        }));
        state.partnerWithdrawals.forEach(w => {
            if(!w) return;
            if (w.partner === 'الشريك 1') totalAbuNibal += (w.usdEquivalent || 0);
            if (w.partner === 'الشريك 2') totalAbuAbdo += (w.usdEquivalent || 0);
            
            html += `<div class="data-list-item">
                <div><strong>سحب ${w.partner || ''}</strong> <span style="font-size:11px;color:#64748b;">${w.note || ''}</span><br><small>${w.date || ''}</small><br><small style="color:#64748b;">${formatUsdEquivalent(w.usdEquivalent)}</small></div>
                <div style="text-align:left; display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
                    <span style="color:var(--danger-color); font-weight:bold;" dir="ltr">${formatCurrencyAmount(w.amount, w.currency, '-')}</span>
                    <button class="action-btn" style="background:var(--danger-color); color:white; border:none;" onclick="deletePartnerWithdrawal('${w.id}')">❌ حذف</button>
                </div>
            </div>`;
        });
        list.innerHTML = html || '<p style="text-align:center; color:#64748b;">لا توجد سحوبات</p>';
    }

    if (capList) {
        let html = '';
        state.capitalRecords = forceArray(state.capitalRecords).map(c => ({
            ...c,
            id: c && c.id ? c.id : generateUniqueID(),
            partner: c && c.partner ? c.partner : '',
            note: c && c.note ? c.note : '',
            amount: Number(c && c.amount) || 0,
            currency: currencyCode(c && c.currency, 'usd'),
            usdEquivalent: Number(c && c.usdEquivalent) || 0,
            date: c && c.date ? c.date : ''
        }));
        state.capitalRecords.forEach(c => {
            if(!c) return;
            html += `<div class="data-list-item">
                <div><strong>إضافة ${c.partner || ''}</strong> <span style="font-size:11px;color:#64748b;">${c.note || ''}</span><br><small>${c.date || ''}</small><br><small style="color:#64748b;">${formatUsdEquivalent(c.usdEquivalent)}</small></div>
                <div style="text-align:left; display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
                    <span style="color:var(--success-color); font-weight:bold;" dir="ltr">${formatCurrencyAmount(c.amount, c.currency, '+')}</span>
                    <button class="action-btn" style="background:var(--danger-color); color:white; border:none;" onclick="deleteCapitalRecord('${c.id}')">❌ حذف</button>
                </div>
            </div>`;
        });
        capList.innerHTML = html || '<p style="text-align:center; color:#64748b;">لا يوجد سجل رأس مال</p>';
    }

    const elNibal = document.getElementById('total-abunibal');
    const elAbdo = document.getElementById('total-abuabdo');
    if(elNibal) elNibal.innerText = totalAbuNibal.toFixed(2) + ' $';
    if(elAbdo) elAbdo.innerText = totalAbuAbdo.toFixed(2) + ' $';
}

// ============================================================
// دوال الصرافة، حركة المادة، النواقص، والنسخ الاحتياطي
// ============================================================
function saveRates() {
    state.rates.try = parseFloat(document.getElementById('rate-try').value) || 0;
    state.rates.syp = parseFloat(document.getElementById('rate-syp').value) || 0;
    trackChange('rates', 'exchangeRates', 'update', state.rates);

saveToLocal();

if (navigator.onLine) {
    SyncManager.performDeltaSync();
}
    alert("✅ تم حفظ أسعار الصرف");
    addAdminLog("تحديث أسعار الصرف", `تركي: ${state.rates.try}, سوري: ${state.rates.syp}`);
}

function updateRatesUI() {
    if(document.getElementById('rate-try')) document.getElementById('rate-try').value = state.rates.try;
    if(document.getElementById('rate-syp')) document.getElementById('rate-syp').value = state.rates.syp;
}

function submitExchange() {
    const fromCurr = document.getElementById('exch-from').value;
    const toCurr = document.getElementById('exch-to').value;
    const fromAmount = parseFloat(document.getElementById('exch-amount-from').value);
    const toAmount = parseFloat(document.getElementById('exch-amount-to').value);

    if (!fromAmount || !toAmount || fromAmount <= 0 || toAmount <= 0) return alert("الرجاء إدخال مبالغ صحيحة");
    if (fromCurr === toCurr) return alert("لا يمكن التصريف لنفس العملة");

    try {
        updateSafe(fromCurr, fromAmount, 'subtract', `تصريف إلى ${currencyLabel(toCurr)}`);
        updateSafe(toCurr, toAmount, 'add', `تصريف من ${currencyLabel(fromCurr)}`);
    } catch (err) {
        return alert(err.message);
    }

    const newId = generateUniqueID();
    const newExchange = {
        id: newId,
        fromCurr, toCurr, fromAmount, toAmount,
        date: new Date().toLocaleString('ar-EG')
    };
    state.exchanges.unshift(newExchange);
    
    trackChange('exchanges', newId, 'create', newExchange);

    saveToLocal();
    updateExchangeUI();
    calculateDashboard();
    
    document.getElementById('exch-amount-from').value = '';
    document.getElementById('exch-amount-to').value = '';
    addAdminLog("عملية صرافة", `تصريف ${fromAmount}${fromCurr} إلى ${toAmount}${toCurr}`);
    alert("✅ تمت عملية التصريف بنجاح");
}

function deleteExchange(id) {
    const idx = state.exchanges.findIndex(ex => ex && String(ex.id) === String(id));
    if (idx === -1) return;
    const ex = normalizeExchangeRecord(state.exchanges[idx]);
    if (!confirm('هل تريد حذف عملية التصريف؟ سيتم عكس أثرها على الصناديق.')) return;

    try {
        updateSafe(ex.fromCurr, Number(ex.fromAmount || 0), 'add', `استرجاع حذف تصريف`);
        updateSafe(ex.toCurr, Number(ex.toAmount || 0), 'subtract', `حذف تصريف`);
    } catch (err) {
        return alert('تعذر حذف عملية التصريف: ' + err.message);
    }

    state.exchanges.splice(idx, 1);
    trackChange('exchanges', ex.id, 'delete', { id: ex.id });
    syncAfterLocalMutation();
    updateExchangeUI();
    calculateDashboard();
    addAdminLog('حذف تصريف', `تم حذف تصريف ${ex.fromAmount} ${ex.fromCurr} إلى ${ex.toAmount} ${ex.toCurr}`);
}

function updateExchangeUI() {
    const list = document.getElementById('exchange-list');
    if (!list) return;
    let html = '';
    state.exchanges = forceArray(state.exchanges).map(normalizeExchangeRecord).filter(Boolean);
    state.exchanges.slice(0, 50).forEach(ex => {
        if(!ex) return;
        html += `<div class="data-list-item">
            <div><strong>تصريف</strong><br><small>${ex.date || ''}</small></div>
            <div style="text-align:left; display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
                <div dir="ltr">
                    <span style="color:var(--danger-color);">${formatCurrencyAmount(ex.fromAmount, ex.fromCurr, '-')}</span> ➔ 
                    <span style="color:var(--success-color);">${formatCurrencyAmount(ex.toAmount, ex.toCurr, '+')}</span>
                </div>
                <button class="action-btn" style="background:var(--danger-color); color:white; border:none;" onclick="deleteExchange('${ex.id}')">❌ حذف</button>
            </div>
        </div>`;
    });
    list.innerHTML = html || '<p style="text-align:center; color:#64748b;">لا توجد عمليات تصريف</p>';
}

function updateShortagesUI() {
    const list = document.getElementById('shortages-list');
    if (!list) return;
    let html = '';
    const shortages = state.products.filter(p => p && p.stock <= 3);
    
    if (shortages.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:var(--success-color); font-weight:bold; padding:20px;">🎉 المخزون ممتاز، لا توجد نواقص!</p>';
        return;
    }

    html += `<table style="width:100%; border-collapse:collapse; text-align:center;" border="1">
        <tr style="background:#fee2e2;"><th>القطعة</th><th>القسم</th><th>المتوفر</th></tr>`;
    shortages.forEach(p => {
        html += `<tr>
            <td style="padding:8px; font-weight:bold;">${p.name}</td>
            <td style="padding:8px;">${p.category}</td>
            <td style="padding:8px; color:var(--danger-color); font-weight:bold;">${p.stock}</td>
        </tr>`;
    });
    html += `</table>`;
    list.innerHTML = html;
}

function filterTrackingProducts() {
    const input = document.getElementById('track-search-input');
    const keyword = input.value.trim();
    const select = document.getElementById('track-product-select');
    if (select) {
        select.innerHTML = '';
        select.value = '';
        select.style.display = 'none';
    }

    if (!keyword) {
        hideProductSearchResults('track-product-results');
        const list = document.getElementById('tracking-list');
        if (list) list.innerHTML = '<p style="text-align:center; color:#64748b;">الرجاء البحث واختيار قطعة لعرض حركتها.</p>';
        return;
    }

    const results = findMatchingProductsForSearch(keyword);
    renderProductSearchResults('track-product-results', results, 'chooseTrackingProduct');
}
const debouncedFilterTracking = filterTrackingProducts;

function chooseTrackingProduct(productId) {
    const prod = state.products.find(p => p && String(p.id) === String(productId));
    if (!prod) return;
    const select = document.getElementById('track-product-select');
    if (select) {
        select.value = String(productId || '');
        select.innerHTML = `<option value="${escapeHtml(productId)}" selected></option>`;
        select.style.display = 'none';
    }
    document.getElementById('track-search-input').value = prod.name;
    hideProductSearchResults('track-product-results');
    renderTrackingList(prod.id);
}

function selectTrackingProduct() {
    const select = document.getElementById('track-product-select');
    const prodId = select ? select.value : '';
    if (prodId) chooseTrackingProduct(prodId);
}

function renderTrackingList(prodId) {
    const list = document.getElementById('tracking-list');
    const tracks = state.itemTracks.filter(t => t && String(t.prodId) === String(prodId)).sort((a,b) => b.timestamp - a.timestamp);
    
    if (tracks.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:#64748b;">لا توجد حركة مسجلة لهذه القطعة.</p>';
        return;
    }

    let html = `<table style="width:100%; border-collapse:collapse; font-size:12px; text-align:center;" border="1">
        <tr style="background:#f1f5f9;"><th>التاريخ</th><th>العملية</th><th>الكمية</th><th>ملاحظات</th></tr>`;
    tracks.forEach(t => {
        let color = t.qty > 0 ? 'green' : 'red';
        let sign = t.qty > 0 ? '+' : '';
        html += `<tr>
            <td style="padding:5px;">${t.date}</td>
            <td style="padding:5px; font-weight:bold;">${t.type}</td>
            <td style="padding:5px; color:${color};" dir="ltr">${sign}${t.qty}</td>
            <td style="padding:5px;">${t.note || ''}</td>
        </tr>`;
    });
    html += `</table>`;
    list.innerHTML = html;
}

function exportBackup() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `AlFares_Backup_${new Date().toISOString().split('T')[0]}.json`);
    dlAnchorElem.click();
    addAdminLog("نسخ احتياطي", "تم تصدير نسخة احتياطية من النظام");
}

function importBackup(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const importedState = JSON.parse(e.target.result);
            Object.assign(state, importedState);
            await saveToLocal();
            updateAllUI();
            alert("✅ تمت استعادة النسخة الاحتياطية بنجاح!");
            addAdminLog("استعادة نسخة", "تمت استعادة البيانات من ملف احتياطي");
        } catch (err) {
            alert("❌ فشل في قراءة ملف النسخة الاحتياطية");
        }
    };
    reader.readAsText(file);
}

function exportToExcel() {
    if (typeof XLSX === 'undefined') return alert("المكتبة قيد التحميل، يرجى المحاولة بعد قليل");
    const ws = XLSX.utils.json_to_sheet(state.products.map(p => ({
        "الاسم": p.name,
        "القسم": p.category,
        "سعر الشراء": p.cost,
        "سعر الجملة": p.wholesale,
        "سعر المفرق": p.retail,
        "الكمية": p.stock
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "المخزون");
    XLSX.writeFile(wb, `AlFares_Inventory_${new Date().toISOString().split('T')[0]}.xlsx`);
    addAdminLog("تصدير إكسيل", "تم تصدير المخزون إلى إكسيل");
}

function importFromExcel(event) {
    if (typeof XLSX === 'undefined') return alert("المكتبة قيد التحميل، يرجى المحاولة بعد قليل");
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const excelData = XLSX.utils.sheet_to_json(firstSheet);
            
            let addedCount = 0;
            let updatedCount = 0;

            excelData.forEach(row => {
                const rawName = row["الاسم"] || row["اسم القطعة"];
                
                if(rawName) {
                    const name = String(rawName).trim();
                    const category = row["القسم"] || state.categories[0] || "عام";
                    
                    const cost = parseFloat(Number(row["سعر الشراء"] || row["تكلفة الشراء"] || 0).toFixed(2));
                    const wholesale = parseFloat(Number(row["سعر الجملة"] || 0).toFixed(2));
                    const retail = parseFloat(Number(row["سعر المفرق"] || 0).toFixed(2));
                    const incomingStock = parseInt(row["الكمية"] || row["الكمية المتوفرة"]) || 0;

                    const existingProdIndex = state.products.findIndex(p => p && p.name === name);

                    if (existingProdIndex !== -1) {
                        const existingProd = state.products[existingProdIndex];
                        existingProd.cost = cost;
                        existingProd.wholesale = wholesale;
                        existingProd.retail = retail;
                        existingProd.stock += incomingStock; 
                        existingProd.category = category;
                        existingProd.version = (existingProd.version || 0) + 1;
                        existingProd._updatedAt = Date.now();

                        trackChange('products', existingProd.id, 'update', existingProd);
                        if (incomingStock > 0) {
                            addTrackRecord(existingProd.id, name, 'إضافة كمية', incomingStock, 'تحديث وزيادة كمية عبر إكسيل');
                        }
                        updatedCount++;
                    } else {
                        const newId = generateUniqueID();
                        const newProd = {
                            id: newId,
                            name: name,
                            category: category,
                            cost: cost,
                            wholesale: wholesale,
                            retail: retail,
                            stock: incomingStock,
                            image: "", version: 1, _updatedAt: Date.now()
                        };

                        state.products.unshift(newProd);
                        trackChange('products', newId, 'create', newProd);
                        addTrackRecord(newId, name, 'إضافة', incomingStock, 'استيراد قطعة جديدة من إكسيل');
                        addedCount++;
                    }
                }
            });
            state.products = dedupeProductsSafe(state.products, { source: 'legacy-excel-import', log: false }).products;
            
            saveToLocal();
            updateProductsUI();
            calculateDashboard();
            
            alert(`✅ اكتمل الاستيراد بنجاح!\n\n✨ تم إضافة: ${addedCount} قطعة جديدة.\n🔄 تم تحديث كميات: ${updatedCount} قطعة موجودة مسبقاً.`);
            addAdminLog("استيراد إكسيل", `إضافة ${addedCount} وتحديث ${updatedCount} قطعة عبر إكسيل`);
            
        } catch (err) {
            alert("❌ خطأ في قراءة ملف الإكسيل: " + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

function saveBulkProducts() {
    const text = document.getElementById('bulk-names').value.trim();
    if (!text) return alert("الرجاء إدخال أسماء القطع");
    
    const category = document.getElementById('bulk-category').value;
    const checks = [
        readNumberInputStrict('bulk-cost', 'Bulk purchase price'),
        readNumberInputStrict('bulk-wholesale', 'Bulk wholesale price'),
        readNumberInputStrict('bulk-retail', 'Bulk retail price'),
        readNumberInputStrict('bulk-stock', 'Bulk stock', { integer: true })
    ];
    const errors = checks.filter(item => !item.ok).map(item => item.error);
    if (errors.length) return alert(errors.join('\n'));
    const [cost, wholesale, retail, stock] = checks.map(item => item.value);

    const lines = text.split('\n');
    let addedCount = 0;

    lines.forEach(line => {
        const name = line.trim();
        if (name) {
            const newId = generateUniqueID();
            const newProd = {
                id: newId, name, category, cost, wholesale, retail, stock,
                image: "", version: 1, _updatedAt: Date.now()
            };
            state.products.unshift(newProd);
            trackChange('products', newId, 'create', newProd);
            addTrackRecord(newId, name, 'إضافة', stock, 'إضافة سريعة للمخزن');
            addedCount++;
        }
    });

    saveToLocal();

if (navigator.onLine) {
    SyncManager.performDeltaSync();
}
    updateProductsUI();
    calculateDashboard();
    document.getElementById('bulk-names').value = '';
    alert(`✅ تم إضافة ${addedCount} قطعة بنجاح`);
    addAdminLog("إضافة مجموعة", `تم إضافة ${addedCount} قطعة إلى قسم ${category}`);
}

function resetAllStock() {
    return zeroProductStockMaintenance();
}

function deleteAllProducts() {
    return deleteAllProductsMaintenance();
}

function summarizeDedupeReport(label, report) {
    if (!report || report.skipped || report.error) {
        return {
            label,
            skipped: true,
            error: report && report.error ? report.error : 'not available',
            totalBefore: 0,
            totalAfter: 0,
            duplicateGroups: 0,
            removedDuplicates: 0,
            confirmedGroups: 0,
            confirmedRemoved: 0,
            suspectedGroups: 0,
            suspectedPotential: 0,
            confirmedExamples: [],
            suspectedExamples: []
        };
    }
    const confirmed = report.confirmedDuplicates || {};
    const suspected = report.suspectedDuplicates || {};
    return {
        label,
        skipped: false,
        totalBefore: Number(report.totalBefore) || 0,
        totalAfter: Number(report.totalAfter) || 0,
        duplicateGroups: Number(report.duplicateGroups) || 0,
        removedDuplicates: Number(report.removedDuplicates) || 0,
        confirmedGroups: Number(confirmed.groups) || 0,
        confirmedRemoved: Number(confirmed.removedDuplicates) || 0,
        suspectedGroups: Number(suspected.groups) || 0,
        suspectedPotential: Number(suspected.potentialDuplicates) || 0,
        confirmedExamples: forceArray(confirmed.examples).slice(0, 20),
        suspectedExamples: forceArray(suspected.examples).slice(0, 20)
    };
}

function buildProductsMaintenanceSummaries(payload) {
    return [
        ['current/state products', payload && payload.currentStateProducts],
        ['firebase products', payload && payload.firebaseProducts],
        ['full_backup products', payload && payload.fullBackupProducts],
        ['local products', payload && payload.localProducts]
    ].map(([label, report]) => summarizeDedupeReport(label, report));
}

function buildProductsMaintenanceReportText(title, summaries) {
    const lines = [title, ''];
    summaries.forEach(summary => {
        lines.push(summary.label);
        if (summary.skipped) {
            lines.push(`  skipped: ${summary.error}`);
        } else {
            lines.push(`  totalBefore: ${summary.totalBefore}`);
            lines.push(`  totalAfter: ${summary.totalAfter}`);
            lines.push(`  duplicateGroups: ${summary.duplicateGroups}`);
            lines.push(`  removedDuplicates: ${summary.removedDuplicates}`);
            lines.push(`  confirmedDuplicates: groups=${summary.confirmedGroups}, removed=${summary.confirmedRemoved}`);
            lines.push(`  suspectedDuplicates: groups=${summary.suspectedGroups}, potential=${summary.suspectedPotential}`);
        }
        lines.push('');
    });
    summaries.forEach(summary => {
        if (summary.confirmedExamples.length || summary.suspectedExamples.length) {
            lines.push(`${summary.label} examples`);
            summary.confirmedExamples.forEach((group, index) => {
                lines.push(`  confirmed ${index + 1}: ${group.key} kept=${group.kept && group.kept.name || ''} count=${group.count}`);
            });
            summary.suspectedExamples.forEach((group, index) => {
                const first = group.items && group.items[0] ? group.items[0] : {};
                lines.push(`  suspected ${index + 1}: ${group.key} first=${first.name || ''} count=${group.count}`);
            });
            lines.push('');
        }
    });
    return lines.join('\n');
}

function renderDuplicateExamples(summary) {
    const rows = [];
    summary.confirmedExamples.forEach((group, index) => {
        rows.push(`<tr><td>${escapeHtml(summary.label)}</td><td>confirmed</td><td>${index + 1}</td><td>${escapeHtml(group.key || '')}</td><td>${escapeHtml(group.kept && group.kept.name || '')}</td><td>${Number(group.count) || 0}</td></tr>`);
    });
    summary.suspectedExamples.forEach((group, index) => {
        const first = group.items && group.items[0] ? group.items[0] : {};
        rows.push(`<tr><td>${escapeHtml(summary.label)}</td><td>suspected</td><td>${index + 1}</td><td>${escapeHtml(group.key || '')}</td><td>${escapeHtml(first.name || '')}</td><td>${Number(group.count) || 0}</td></tr>`);
    });
    return rows;
}

function renderProductsMaintenanceReport(title, payload) {
    const target = document.getElementById('products-maintenance-report');
    const summaries = buildProductsMaintenanceSummaries(payload || {});
    const text = buildProductsMaintenanceReportText(title, summaries);
    window.__ABN_PRODUCTS_MAINTENANCE_REPORT_TEXT__ = text;
    if (target) {
        target.style.direction = 'ltr';
        target.style.textAlign = 'left';
        const rows = summaries.map(summary => {
            if (summary.skipped) {
                return `<tr><td>${escapeHtml(summary.label)}</td><td colspan="8">${escapeHtml(summary.error)}</td></tr>`;
            }
            return `<tr>
                <td>${escapeHtml(summary.label)}</td>
                <td>${summary.totalBefore}</td>
                <td>${summary.totalAfter}</td>
                <td>${summary.duplicateGroups}</td>
                <td>${summary.removedDuplicates}</td>
                <td>${summary.confirmedGroups}</td>
                <td>${summary.confirmedRemoved}</td>
                <td>${summary.suspectedGroups}</td>
                <td>${summary.suspectedPotential}</td>
            </tr>`;
        }).join('');
        const exampleRows = summaries.flatMap(renderDuplicateExamples).slice(0, 20).join('');
        target.innerHTML = `
            <div style="display:flex; justify-content:space-between; gap:10px; align-items:center; margin-bottom:10px;">
                <strong>${escapeHtml(title)}</strong>
                <button type="button" onclick="copyProductsMaintenanceReport()" style="width:auto; padding:8px 12px; background:#475569;">نسخ التقرير</button>
            </div>
            <div style="overflow:auto;">
                <table style="width:100%; border-collapse:collapse; text-align:center;" border="1">
                    <thead><tr><th>source</th><th>totalBefore</th><th>totalAfter</th><th>duplicateGroups</th><th>removedDuplicates</th><th>confirmed groups</th><th>confirmed removed</th><th>suspected groups</th><th>suspected potential</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <div style="margin-top:12px; font-weight:700;">أول 20 مجموعة تكرار للمعاينة</div>
            <div style="overflow:auto;">
                <table style="width:100%; border-collapse:collapse; text-align:center;" border="1">
                    <thead><tr><th>source</th><th>type</th><th>#</th><th>key</th><th>sample product</th><th>group count</th></tr></thead>
                    <tbody>${exampleRows || '<tr><td colspan="6">لا توجد أمثلة تكرار.</td></tr>'}</tbody>
                </table>
            </div>`;
        target.style.display = 'block';
    } else {
        console.log(text);
    }
}

async function copyProductsMaintenanceReport() {
    const text = window.__ABN_PRODUCTS_MAINTENANCE_REPORT_TEXT__ || '';
    if (!text) return alert('No report to copy.');
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        }
        alert('Report copied.');
    } catch (error) {
        console.error(error);
        alert('Copy failed. You can select the report text manually.');
    }
}

let masterProductsReplacePreviewState = null;

function masterProductsFileSignature(file) {
    if (!file) return '';
    return [file.name || '', file.size || 0, file.lastModified || 0].join('|');
}

function setMasterProductsConfirmEnabled(enabled) {
    const btn = document.getElementById('confirm-master-products-replace-btn');
    if (btn) btn.disabled = !enabled;
}

function resetMasterProductsReplacePreview() {
    masterProductsReplacePreviewState = null;
    setMasterProductsConfirmEnabled(false);
}

function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('فشل قراءة ملف Excel'));
        reader.readAsArrayBuffer(file);
    });
}

function headerIndexMap(headers) {
    const map = {};
    headers.forEach((value, index) => {
        const key = String(value ?? '').trim();
        if (key && map[key] === undefined) map[key] = index;
    });
    return map;
}

function rowValue(row, map, key) {
    const index = map[key];
    return index === undefined ? '' : row[index];
}

function hasMappedRowData(row, map) {
    return ['الاسم', 'القسم', 'سعر الشراء', 'سعر الجملة', 'سعر المفرق', 'الكمية']
        .some(key => String(rowValue(row, map, key) ?? '').trim() !== '');
}

function duplicateMasterProductGroups(products) {
    const groups = new Map();
    products.forEach(product => {
        const key = `${normalizeProductText(product.name)}::${normalizeProductText(product.category)}`;
        if (!key || key === '::') return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(product);
    });
    return Array.from(groups.entries())
        .filter(([, items]) => items.length > 1)
        .map(([key, items]) => ({
            key,
            count: items.length,
            samples: items.slice(0, 5).map(item => ({ id: item.id, name: item.name, category: item.category }))
        }));
}

async function parseMasterProductsExcel(file) {
    if (typeof XLSX === 'undefined') throw new Error('مكتبة Excel غير محملة بعد.');
    const data = new Uint8Array(await readFileAsArrayBuffer(file));
    const workbook = XLSX.read(data, { type: 'array', cellDates: false });
    const sheetName = workbook.SheetNames.find(name => name === MASTER_PRODUCTS_SHEET_NAME);
    const report = {
        fileName: file.name || '',
        fileSignature: masterProductsFileSignature(file),
        expectedCount: MASTER_PRODUCTS_EXPECTED_COUNT,
        sheetName: sheetName || MASTER_PRODUCTS_SHEET_NAME,
        sheetFound: Boolean(sheetName),
        readCount: 0,
        countMatchesExpected: false,
        emptyNames: 0,
        emptyCategories: 0,
        invalidPrices: 0,
        invalidQuantities: 0,
        duplicateGroups: 0,
        duplicateExamples: [],
        errors: [],
        sampleProducts: [],
        importedProducts: [],
        valid: false,
        blockReasons: []
    };

    if (!sheetName) {
        report.errors.push(`الشيت "${MASTER_PRODUCTS_SHEET_NAME}" غير موجود.`);
        report.blockReasons.push('الشيت الأساسي غير موجود.');
        return report;
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
    const requiredHeaders = ['الاسم', 'القسم', 'سعر الشراء', 'سعر الجملة', 'سعر المفرق', 'الكمية'];
    const headerRowIndex = rows.findIndex(row => {
        const values = new Set((row || []).map(value => String(value ?? '').trim()).filter(Boolean));
        return requiredHeaders.every(header => values.has(header));
    });

    if (headerRowIndex < 0) {
        report.errors.push('لم يتم العثور على صف العناوين المطلوب: الاسم، القسم، سعر الشراء، سعر الجملة، سعر المفرق، الكمية.');
        report.blockReasons.push('أعمدة Excel المطلوبة غير مكتملة.');
        return report;
    }

    const map = headerIndexMap(rows[headerRowIndex] || []);
    for (let index = headerRowIndex + 1; index < rows.length; index++) {
        const row = rows[index] || [];
        if (!hasMappedRowData(row, map)) continue;

        report.readCount++;
        const excelRowNumber = index + 1;
        const rawName = String(rowValue(row, map, 'الاسم') ?? '').trim();
        const rawCategory = String(rowValue(row, map, 'القسم') ?? '').trim();
        const cost = parseMasterNumberCell(rowValue(row, map, 'سعر الشراء'));
        const wholesale = parseMasterNumberCell(rowValue(row, map, 'سعر الجملة'));
        const retail = parseMasterNumberCell(rowValue(row, map, 'سعر المفرق'));
        const stock = parseMasterNumberCell(rowValue(row, map, 'الكمية'), { integer: true });
        const rowErrors = [];

        if (!rawName) {
            report.emptyNames++;
            rowErrors.push('الاسم فارغ');
        }
        if (!rawCategory) {
            report.emptyCategories++;
            rowErrors.push('القسم فارغ');
        }
        [
            ['سعر الشراء', cost],
            ['سعر الجملة', wholesale],
            ['سعر المفرق', retail]
        ].forEach(([label, parsed]) => {
            if (!parsed.ok) {
                report.invalidPrices++;
                rowErrors.push(`${label} فارغ أو غير رقمي`);
            }
        });
        if (!stock.ok) {
            report.invalidQuantities++;
            rowErrors.push('الكمية فارغة أو غير رقمية');
        }

        if (rowErrors.length) {
            report.errors.push(`صف ${excelRowNumber}: ${rowErrors.join('، ')}`);
            continue;
        }

        const product = {
            id: createMasterProductId(rawName, rawCategory),
            name: rawName,
            category: rawCategory,
            cost: cost.value,
            wholesale: wholesale.value,
            retail: retail.value,
            stock: stock.value,
            image: '',
            version: 1,
            masterImportSource: MASTER_PRODUCTS_EXPECTED_SOURCE
        };
        report.importedProducts.push(product);
        if (report.sampleProducts.length < 10) report.sampleProducts.push(product);
    }

    const duplicateGroups = duplicateMasterProductGroups(report.importedProducts);
    report.duplicateGroups = duplicateGroups.length;
    report.duplicateExamples = duplicateGroups.slice(0, 20);
    duplicateGroups.slice(0, 20).forEach(group => {
        report.errors.push(`تكرار داخل Excel: ${group.key} (${group.count} منتجات)`);
    });

    report.countMatchesExpected = report.readCount === MASTER_PRODUCTS_EXPECTED_COUNT;
    if (report.readCount !== MASTER_PRODUCTS_EXPECTED_COUNT) {
        report.blockReasons.push(`عدد المنتجات المقروءة ${report.readCount} وليس ${MASTER_PRODUCTS_EXPECTED_COUNT}.`);
    }
    if (report.emptyNames) report.blockReasons.push(`يوجد ${report.emptyNames} أسماء فارغة.`);
    if (report.invalidPrices) report.blockReasons.push(`يوجد ${report.invalidPrices} أسعار فارغة أو غير رقمية.`);
    if (report.invalidQuantities) report.blockReasons.push(`يوجد ${report.invalidQuantities} كميات فارغة أو غير رقمية.`);
    if (report.duplicateGroups) report.blockReasons.push(`يوجد ${report.duplicateGroups} مجموعات تكرار داخل Excel.`);
    report.valid = report.blockReasons.length === 0;
    return report;
}

function countProductsValue(value) {
    return forceArray(value).length;
}

async function loadMasterProductsExistingCounts() {
    const counts = {
        stateProducts: { count: countProductsValue(state.products) },
        firebaseProducts: { skipped: true, error: 'not checked' },
        fullBackupProducts: { skipped: true, error: 'not checked' }
    };
    try {
        if (!navigator.onLine) {
            counts.firebaseProducts = { skipped: true, error: 'offline' };
            counts.fullBackupProducts = { skipped: true, error: 'offline' };
            return counts;
        }
        const access = await ensureFirebaseAccess();
        if (!access.ok) {
            counts.firebaseProducts = { skipped: true, error: access.error };
            counts.fullBackupProducts = { skipped: true, error: access.error };
            return counts;
        }
        const [productsSnap, fullBackupProductsSnap] = await Promise.all([
            db.ref('products').once('value'),
            db.ref('full_backup/products').once('value')
        ]);
        counts.firebaseProducts = { count: countProductsValue(productsSnap.val()) };
        counts.fullBackupProducts = fullBackupProductsSnap.exists()
            ? { count: countProductsValue(fullBackupProductsSnap.val()) }
            : { count: 0, missing: true };
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        counts.firebaseProducts = { skipped: true, error: message };
        counts.fullBackupProducts = { skipped: true, error: message };
    }
    return counts;
}

function countLabel(item) {
    if (!item) return 'غير متاح';
    if (item.skipped) return `لم يتم الفحص: ${item.error || ''}`;
    if (item.missing) return `${item.count} (full_backup.products غير موجود)`;
    return String(Number(item.count) || 0);
}

function buildMasterProductsImportReportText(report) {
    const lines = [
        'استبدال المنتجات من ملف Excel - Preview',
        `fileName: ${report.fileName}`,
        `sheetName: ${report.sheetName}`,
        `readCount: ${report.readCount}`,
        `expectedCount: ${report.expectedCount}`,
        `countMatchesExpected: ${report.countMatchesExpected ? 'yes' : 'no'}`,
        `emptyNames: ${report.emptyNames}`,
        `emptyCategories: ${report.emptyCategories}`,
        `invalidPrices: ${report.invalidPrices}`,
        `invalidQuantities: ${report.invalidQuantities}`,
        `duplicateGroups: ${report.duplicateGroups}`,
        `confirmAllowed: ${report.valid ? 'yes' : 'no'}`,
        '',
        `stateProducts: ${countLabel(report.counts && report.counts.stateProducts)}`,
        `firebaseProducts: ${countLabel(report.counts && report.counts.firebaseProducts)}`,
        `fullBackupProducts: ${countLabel(report.counts && report.counts.fullBackupProducts)}`,
        ''
    ];
    if (report.blockReasons && report.blockReasons.length) {
        lines.push('blockReasons:');
        report.blockReasons.forEach(reason => lines.push(`- ${reason}`));
        lines.push('');
    }
    if (report.errors && report.errors.length) {
        lines.push('firstErrors:');
        report.errors.slice(0, 20).forEach(error => lines.push(`- ${error}`));
        lines.push('');
    }
    if (report.sampleProducts && report.sampleProducts.length) {
        lines.push('sampleProducts:');
        report.sampleProducts.slice(0, 10).forEach(product => {
            lines.push(`- ${product.id} | ${product.name} | ${product.category} | cost=${product.cost} wholesale=${product.wholesale} retail=${product.retail} stock=${product.stock}`);
        });
    }
    return lines.join('\n');
}

function renderMasterProductsImportReport(report, title = 'معاينة استبدال المنتجات من Excel') {
    const target = document.getElementById('products-maintenance-report');
    const text = buildMasterProductsImportReportText(report);
    window.__ABN_PRODUCTS_MAINTENANCE_REPORT_TEXT__ = text;
    if (!target) return console.log(text);

    target.style.direction = 'rtl';
    target.style.textAlign = 'right';
    const summaryRows = [
        ['اسم الملف', report.fileName],
        ['اسم الشيت', report.sheetName],
        ['عدد المنتجات المقروءة', report.readCount],
        ['هل العدد = 1303', report.countMatchesExpected ? 'نعم' : 'لا'],
        ['عدد الأسماء الفارغة', report.emptyNames],
        ['عدد الأقسام الفارغة', report.emptyCategories],
        ['عدد الأسعار الفارغة أو غير الرقمية', report.invalidPrices],
        ['عدد الكميات الفارغة أو غير الرقمية', report.invalidQuantities],
        ['عدد التكرارات داخل ملف Excel', report.duplicateGroups],
        ['حالة تنفيذ الاستبدال', report.valid ? 'مسموح بعد التأكيد النهائي' : 'ممنوع حتى تصحيح الملف']
    ].map(([label, value]) => `<tr><th style="padding:6px; text-align:right;">${escapeHtml(label)}</th><td style="padding:6px;">${escapeHtml(value)}</td></tr>`).join('');
    const countRows = [
        ['current/state products', report.counts && report.counts.stateProducts],
        ['firebase products', report.counts && report.counts.firebaseProducts],
        ['full_backup products', report.counts && report.counts.fullBackupProducts]
    ].map(([label, item]) => `<tr><td style="padding:6px;">${escapeHtml(label)}</td><td style="padding:6px;">${escapeHtml(countLabel(item))}</td></tr>`).join('');
    const errorRows = (report.errors || []).slice(0, 20)
        .map((error, index) => `<tr><td style="padding:6px;">${index + 1}</td><td style="padding:6px;">${escapeHtml(error)}</td></tr>`)
        .join('');
    const sampleRows = (report.sampleProducts || []).slice(0, 10)
        .map(product => `<tr><td style="padding:6px;">${escapeHtml(product.id)}</td><td style="padding:6px;">${escapeHtml(product.name)}</td><td style="padding:6px;">${escapeHtml(product.category)}</td><td style="padding:6px;">${product.cost}</td><td style="padding:6px;">${product.wholesale}</td><td style="padding:6px;">${product.retail}</td><td style="padding:6px;">${product.stock}</td></tr>`)
        .join('');
    const blockItems = (report.blockReasons || [])
        .map(reason => `<li>${escapeHtml(reason)}</li>`)
        .join('');

    target.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:center; margin-bottom:10px;">
            <strong>${escapeHtml(title)}</strong>
            <button type="button" onclick="copyProductsMaintenanceReport()" style="width:auto; padding:8px 12px; background:#475569;">نسخ التقرير</button>
        </div>
        <table style="width:100%; border-collapse:collapse;" border="1"><tbody>${summaryRows}</tbody></table>
        <div style="margin-top:12px; font-weight:800;">مصادر المنتجات الحالية</div>
        <table style="width:100%; border-collapse:collapse;" border="1"><thead><tr><th>المصدر</th><th>العدد</th></tr></thead><tbody>${countRows}</tbody></table>
        ${blockItems ? `<div style="margin-top:12px; color:#b91c1c; font-weight:800;">أسباب منع التنفيذ</div><ul>${blockItems}</ul>` : '<div style="margin-top:12px; color:#15803d; font-weight:800;">Preview ناجح. يمكن تنفيذ الاستبدال بعد التأكيد النهائي.</div>'}
        <div style="margin-top:12px; font-weight:800;">أول 20 خطأ</div>
        <table style="width:100%; border-collapse:collapse;" border="1"><thead><tr><th>#</th><th>الخطأ</th></tr></thead><tbody>${errorRows || '<tr><td colspan="2">لا توجد أخطاء.</td></tr>'}</tbody></table>
        <div style="margin-top:12px; font-weight:800;">أول 10 منتجات كعينة</div>
        <table style="width:100%; border-collapse:collapse;" border="1"><thead><tr><th>id</th><th>الاسم</th><th>القسم</th><th>شراء</th><th>جملة</th><th>مفرق</th><th>كمية</th></tr></thead><tbody>${sampleRows || '<tr><td colspan="7">لا توجد عينات.</td></tr>'}</tbody></table>`;
    target.style.display = 'block';
}

async function previewReplaceProductsFromMasterExcel() {
    const input = document.getElementById('master-products-excel-file');
    const file = input && input.files && input.files[0];
    if (!file) return alert('اختر ملف Excel أولًا.');

    setMasterProductsConfirmEnabled(false);
    showSpinner(true);
    try {
        const report = await parseMasterProductsExcel(file);
        report.counts = await loadMasterProductsExistingCounts();
        masterProductsReplacePreviewState = report;
        renderMasterProductsImportReport(report);
        setMasterProductsConfirmEnabled(report.valid);
        if (!report.valid) {
            alert('تمت المعاينة، لكن تنفيذ الاستبدال ممنوع حتى تصحيح الأسباب الظاهرة في التقرير.');
        }
        return report;
    } catch (error) {
        const report = {
            fileName: file.name || '',
            fileSignature: masterProductsFileSignature(file),
            expectedCount: MASTER_PRODUCTS_EXPECTED_COUNT,
            sheetName: MASTER_PRODUCTS_SHEET_NAME,
            readCount: 0,
            countMatchesExpected: false,
            emptyNames: 0,
            emptyCategories: 0,
            invalidPrices: 0,
            invalidQuantities: 0,
            duplicateGroups: 0,
            errors: [error && error.message ? error.message : String(error)],
            sampleProducts: [],
            blockReasons: ['تعذر قراءة ملف Excel.'],
            counts: { stateProducts: { count: countProductsValue(state.products) } },
            valid: false
        };
        masterProductsReplacePreviewState = report;
        renderMasterProductsImportReport(report);
        alert('فشلت معاينة ملف Excel: ' + report.errors[0]);
        return report;
    } finally {
        showSpinner(false);
    }
}

async function createFirebaseMasterProductsBackup(reason) {
    const access = await ensureFirebaseAccess();
    if (!access.ok) throw new Error(access.error);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `backups/${reason}-${stamp}`;
    const snapshot = await db.ref().once('value');
    const data = snapshot.val() || {};
    const firebaseSnapshot = { ...data };
    delete firebaseSnapshot.backups;
    await db.ref(path).set({
        reason,
        type: 'full-before-products-replace',
        createdAt: Date.now(),
        deviceId: DEVICE_ID,
        firebaseSnapshot
    });
    return path;
}

function renderMasterProductsReplaceSuccessReport(result) {
    const report = {
        fileName: result.fileName,
        expectedCount: MASTER_PRODUCTS_EXPECTED_COUNT,
        sheetName: MASTER_PRODUCTS_SHEET_NAME,
        readCount: result.importedCount,
        countMatchesExpected: result.importedCount === MASTER_PRODUCTS_EXPECTED_COUNT,
        emptyNames: 0,
        emptyCategories: 0,
        invalidPrices: 0,
        invalidQuantities: 0,
        duplicateGroups: 0,
        errors: [],
        sampleProducts: result.sampleProducts || [],
        blockReasons: [],
        counts: {
            stateProducts: { count: result.importedCount },
            firebaseProducts: { count: result.importedCount },
            fullBackupProducts: { count: result.importedCount }
        },
        valid: true
    };
    renderMasterProductsImportReport(report, 'تم استبدال المنتجات بنجاح');
    window.__ABN_PRODUCTS_MAINTENANCE_REPORT_TEXT__ = [
        'تم استبدال المنتجات بنجاح',
        `oldFirebaseCount: ${Number(result.oldFirebaseCount) || 0}`,
        `oldFullBackupCount: ${Number(result.oldFullBackupCount) || 0}`,
        `importedCount: ${Number(result.importedCount) || 0}`,
        `backupPath: ${result.backupPath || ''}`,
        `productsReplacedAt: ${Number(result.productsReplacedAt) || 0}`,
        `source: ${MASTER_PRODUCTS_EXPECTED_SOURCE}`
    ].join('\n');
    const target = document.getElementById('products-maintenance-report');
    if (target) {
        target.insertAdjacentHTML('afterbegin', `
            <div style="margin-bottom:12px; padding:10px; background:#ecfdf5; border:1px solid #86efac; border-radius:8px;">
                <div><strong>oldFirebaseCount:</strong> ${Number(result.oldFirebaseCount) || 0}</div>
                <div><strong>oldFullBackupCount:</strong> ${Number(result.oldFullBackupCount) || 0}</div>
                <div><strong>importedCount:</strong> ${Number(result.importedCount) || 0}</div>
                <div><strong>backupPath:</strong> ${escapeHtml(result.backupPath)}</div>
                <div><strong>productsReplacedAt:</strong> ${Number(result.productsReplacedAt) || 0}</div>
            </div>`);
    }
}

async function confirmReplaceProductsFromMasterExcel() {
    const preview = masterProductsReplacePreviewState;
    const input = document.getElementById('master-products-excel-file');
    const file = input && input.files && input.files[0];
    if (!preview || !preview.valid) return alert('يجب تنفيذ Preview ناجح قبل الاستبدال.');
    if (!file || masterProductsFileSignature(file) !== preview.fileSignature) {
        resetMasterProductsReplacePreview();
        return alert('تغير ملف Excel بعد المعاينة. نفذ Preview من جديد.');
    }
    if (!navigator.onLine) return alert('يتطلب الاستبدال اتصالًا بالإنترنت و Firebase.');

    const typed = prompt(`هذا الإجراء سيستبدل Firebase products و full_backup.products فقط.\nلن يتم حذف الفواتير أو العملاء أو الموردين أو المصاريف أو المبيعات.\n\nاكتب العبارة التالية حرفيًا للتأكيد:\n${MASTER_PRODUCTS_CONFIRM_PHRASE}`);
    if (typed !== MASTER_PRODUCTS_CONFIRM_PHRASE) return alert('تم إلغاء الاستبدال.');
    if (!confirm(`سيتم استبدال المنتجات بـ ${preview.importedProducts.length} منتج بعد إنشاء Backup كامل. هل تريد المتابعة؟`)) return;

    showSpinner(true);
    try {
        const access = await ensureFirebaseAccess();
        if (!access.ok) throw new Error(access.error);
        const [productsSnap, fullBackupProductsSnap] = await Promise.all([
            db.ref('products').once('value'),
            db.ref('full_backup/products').once('value')
        ]);
        const oldFirebaseCount = countProductsValue(productsSnap.val());
        const oldFullBackupCount = countProductsValue(fullBackupProductsSnap.val());
        const backupPath = await createFirebaseMasterProductsBackup('before-replace-products-from-master');
        const now = Date.now();
        const importedProducts = preview.importedProducts.map(product => ({
            ...product,
            version: 1,
            _updatedAt: now,
            _deviceId: DEVICE_ID,
            productsResetGeneration: now,
            masterImportSource: MASTER_PRODUCTS_EXPECTED_SOURCE
        }));
        const importedObject = arrayToObjectById(importedProducts);
        const updates = await productSyncChangesCleanupUpdates(now);

        updates.products = importedObject;
        updates['full_backup/products'] = importedObject;
        updates['maintenance/productsReplacedAt'] = now;
        updates['maintenance/productsResetGeneration'] = now;
        updates['maintenance/productsMasterImportCount'] = MASTER_PRODUCTS_EXPECTED_COUNT;
        updates['maintenance/productsMasterImportSource'] = MASTER_PRODUCTS_EXPECTED_SOURCE;
        updates['maintenance/productsMasterImportFileName'] = preview.fileName;
        updates['maintenance/productsMasterImportBackupPath'] = backupPath;
        updates['maintenance/productsMasterImportDeviceId'] = DEVICE_ID;

        await db.ref().update(updates);
        writeProductsReplacementMarker({
            productsReplacedAt: now,
            productsResetGeneration: now,
            productsMasterImportCount: MASTER_PRODUCTS_EXPECTED_COUNT,
            productsMasterImportSource: MASTER_PRODUCTS_EXPECTED_SOURCE
        });
        state.products = importedProducts;
        removeLocalProductSyncArtifacts();
        await clearPendingProductImages();
        await saveToLocal();
        updateAllUI();
        const result = {
            fileName: preview.fileName,
            oldFirebaseCount,
            oldFullBackupCount,
            importedCount: importedProducts.length,
            backupPath,
            productsReplacedAt: now,
            sampleProducts: importedProducts.slice(0, 10)
        };
        renderMasterProductsReplaceSuccessReport(result);
        alert(`تم الاستبدال بنجاح.\noldFirebaseCount: ${oldFirebaseCount}\noldFullBackupCount: ${oldFullBackupCount}\nimportedCount: ${importedProducts.length}\nbackupPath: ${backupPath}`);
        return result;
    } catch (error) {
        console.error(error);
        alert('فشل استبدال المنتجات: ' + explainFirebasePermissionError(error));
    } finally {
        showSpinner(false);
    }
}

function productObjectFromList(products) {
    return arrayToObjectById(dedupeProductsSafe(products, { source: 'productObjectFromList', log: false }).products);
}

function removeLocalProductSyncArtifacts() {
    if (typeof SyncQueue !== 'undefined' && Array.isArray(SyncQueue.items)) {
        SyncQueue.items = SyncQueue.items.filter(change => change && change.collection !== 'products');
        try { SyncQueue.save(); } catch (error) { console.warn('Failed to save pruned product queue:', error); }
    }
    ['abonibalProductionSyncQueueV2', 'abonibalProductionSyncQueueLegacy'].forEach(key => {
        try {
            const filtered = safeJsonParse(localStorage.getItem(key), []).filter(change => change && change.collection !== 'products');
            if (filtered.length) localStorage.setItem(key, JSON.stringify(filtered));
            else localStorage.removeItem(key);
        } catch (_) {}
    });
    try { localStorage.removeItem('largeExcelImportPendingChangesV1'); } catch (_) {}
    try {
        if (typeof localforage !== 'undefined' && localforage.removeItem) {
            localforage.getItem('abonibalProductionSyncQueueV2Overflow')
                .then(items => {
                    const filtered = forceArray(items).filter(change => change && change.collection !== 'products');
                    return filtered.length
                        ? localforage.setItem('abonibalProductionSyncQueueV2Overflow', filtered)
                        : localforage.removeItem('abonibalProductionSyncQueueV2Overflow');
                })
                .catch(error => console.warn('Failed to clear product queue overflow:', error));
        }
    } catch (_) {}
}

async function clearPendingProductImages() {
    try {
        await localforage.setItem(SYNC_PENDING_IMAGES_KEY, []);
    } catch (error) {
        console.warn('Failed to clear pending product images:', error);
    }
}

async function productSyncChangesCleanupUpdates(now) {
    const updates = {};
    const snapshot = await db.ref('sync/changes').once('value');
    const changes = snapshot.val() || {};
    Object.keys(changes).forEach(id => {
        const change = changes[id];
        if (change && change.collection === 'products') updates[`sync/changes/${id}`] = null;
    });
    updates['maintenance/productsResetGeneration'] = now;
    updates['sync/lastSyncTime'] = now;
    return updates;
}

async function createFirebaseProductsBackup(reason) {
    const access = await ensureFirebaseAccess();
    if (!access.ok) throw new Error(access.error);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `backups/${reason}-${stamp}`;
    const [productsSnap, fullBackupProductsSnap, changesSnap, maintenanceSnap] = await Promise.all([
        db.ref('products').once('value'),
        db.ref('full_backup/products').once('value'),
        db.ref('sync/changes').once('value'),
        db.ref('maintenance').once('value')
    ]);
    const productChanges = {};
    const changes = changesSnap.val() || {};
    Object.keys(changes).forEach(id => {
        const change = changes[id];
        if (change && change.collection === 'products') productChanges[id] = change;
    });
    await db.ref(path).set({
        reason,
        createdAt: Date.now(),
        deviceId: DEVICE_ID,
        products: productsSnap.val() || null,
        fullBackupProducts: fullBackupProductsSnap.val() || null,
        productSyncChanges: productChanges,
        maintenance: maintenanceSnap.val() || null
    });
    return path;
}

async function previewDuplicateProductsMaintenance() {
    const reports = {
        currentStateProducts: dedupeProductsSafe(state.products, { source: 'maintenance-preview-current-state', log: false })
    };
    try {
        const localProducts = await localforage.getItem(STORAGE_KEYS.PRODUCTS);
        reports.localProducts = dedupeProductsSafe(localProducts || [], { source: 'maintenance-preview-localforage', log: false });
    } catch (error) {
        reports.localProducts = { skipped: true, error: error && error.message ? error.message : String(error) };
    }
    try {
        if (navigator.onLine) {
            const access = await ensureFirebaseAccess();
            if (access.ok) {
                const [productsSnap, fullBackupProductsSnap] = await Promise.all([
                    db.ref('products').once('value'),
                    db.ref('full_backup/products').once('value')
                ]);
                reports.firebaseProducts = dedupeProductsSafe(productsSnap.val() || [], { source: 'maintenance-preview-firebase', log: false });
                reports.fullBackupProducts = dedupeProductsSafe(fullBackupProductsSnap.val() || [], { source: 'maintenance-preview-full-backup', log: false });
            } else {
                reports.firebaseProducts = { skipped: true, error: access.error };
                reports.fullBackupProducts = { skipped: true, error: access.error };
            }
        } else {
            reports.firebaseProducts = { skipped: true, error: 'offline' };
            reports.fullBackupProducts = { skipped: true, error: 'offline' };
        }
    } catch (error) {
        reports.firebaseProducts = { skipped: true, error: error && error.message ? error.message : String(error) };
        reports.fullBackupProducts = { skipped: true, error: error && error.message ? error.message : String(error) };
    }
    renderProductsMaintenanceReport('Product duplicate preview', reports);
    return reports;
}

async function confirmDedupeProductsMaintenance() {
    if (!navigator.onLine) return alert('Internet connection is required for Firebase product cleanup.');

    showSpinner(true);
    try {
        const access = await ensureFirebaseAccess();
        if (!access.ok) throw new Error(access.error);
        const [productsSnap, fullBackupProductsSnap] = await Promise.all([
            db.ref('products').once('value'),
            db.ref('full_backup/products').once('value')
        ]);
        const productReport = dedupeProductsSafe(productsSnap.val() || [], { source: 'maintenance-confirm-products' });
        const fullBackupExists = fullBackupProductsSnap.exists();
        const fullBackupReport = dedupeProductsSafe(fullBackupProductsSnap.val() || [], { source: 'maintenance-confirm-full-backup' });
        const confirmedToRemove =
            Number(productReport.confirmedDuplicates && productReport.confirmedDuplicates.removedDuplicates || 0) +
            (fullBackupExists ? Number(fullBackupReport.confirmedDuplicates && fullBackupReport.confirmedDuplicates.removedDuplicates || 0) : 0);
        const suspectedToKeep =
            Number(productReport.suspectedDuplicates && productReport.suspectedDuplicates.potentialDuplicates || 0) +
            (fullBackupExists ? Number(fullBackupReport.suspectedDuplicates && fullBackupReport.suspectedDuplicates.potentialDuplicates || 0) : 0);

        renderProductsMaintenanceReport('Product duplicate cleanup confirmation', {
            firebaseProducts: productReport,
            fullBackupProducts: fullBackupReport,
            currentStateProducts: dedupeProductsSafe(state.products, { source: 'maintenance-confirm-current-state', log: false }),
            localProducts: dedupeProductsSafe(await localforage.getItem(STORAGE_KEYS.PRODUCTS) || [], { source: 'maintenance-confirm-localforage', log: false })
        });

        if (confirmedToRemove <= 0) {
            alert(`No confirmed duplicates to clean. Suspected duplicates left for manual review: ${suspectedToKeep}.`);
            return;
        }

        const ok = confirm(`Confirmed duplicates to remove: ${confirmedToRemove}\nSuspected duplicates kept untouched: ${suspectedToKeep}\n\nA Firebase backup will be created before any write. Continue?`);
        if (!ok) return alert('Cancelled.');
        const typed = prompt('Final confirmation: type CLEAN CONFIRMED PRODUCTS to clean confirmed duplicates only.');
        if (typed !== 'CLEAN CONFIRMED PRODUCTS') return alert('Cancelled.');

        const backupPath = await createFirebaseProductsBackup('before-products-dedupe');
        const now = Date.now();
        const updates = await productSyncChangesCleanupUpdates(now);
        updates.products = productObjectFromList(productReport.products);
        if (fullBackupExists) updates['full_backup/products'] = productObjectFromList(fullBackupReport.products);
        updates['maintenance/productsDedupeAt'] = now;
        updates['maintenance/productsDedupeVersion'] = PRODUCT_MAINTENANCE_VERSION;
        updates['maintenance/productsDedupeBackupPath'] = backupPath;

        await db.ref().update(updates);
        state.products = productReport.products;
        removeLocalProductSyncArtifacts();
        await clearPendingProductImages();
        await saveToLocal();
        updateAllUI();
        addAdminLog('Product dedupe', `Cleaned products after backup ${backupPath}`);
        renderProductsMaintenanceReport('Product duplicate cleanup complete', {
            firebaseProducts: productReport,
            fullBackupProducts: fullBackupReport,
            currentStateProducts: dedupeProductsSafe(state.products, { source: 'maintenance-cleanup-current-state', log: false }),
            localProducts: dedupeProductsSafe(await localforage.getItem(STORAGE_KEYS.PRODUCTS) || [], { source: 'maintenance-cleanup-localforage', log: false }),
            backupPath
        });
        alert(`Confirmed duplicate cleanup completed after backup.\nRemoved confirmed duplicates: ${confirmedToRemove}\nSuspected duplicates left untouched: ${suspectedToKeep}`);
    } catch (error) {
        console.error(error);
        alert('Product duplicate cleanup failed: ' + explainFirebasePermissionError(error));
    } finally {
        showSpinner(false);
    }
}

async function deleteAllProductsMaintenance() {
    const mode = prompt('Type LOCAL to delete products only on this device, or FIREBASE to delete products for all devices.');
    if (mode !== 'LOCAL' && mode !== 'FIREBASE') return alert('Cancelled.');

    if (mode === 'LOCAL') {
        const typed = prompt('Type DELETE LOCAL PRODUCTS to confirm local-only product deletion.');
        if (typed !== 'DELETE LOCAL PRODUCTS') return alert('Cancelled.');
        state.products = [];
        removeLocalProductSyncArtifacts();
        await clearPendingProductImages();
        await saveToLocal();
        updateAllUI();
        addAdminLog('Local product delete', 'Deleted products from this device only. Firebase was not deleted.');
        alert('Products were deleted from this device only. Firebase was not deleted.');
        return;
    }

    const typed = prompt('Type DELETE FIREBASE PRODUCTS to delete products for all devices after backup.');
    if (typed !== 'DELETE FIREBASE PRODUCTS') return alert('Cancelled.');
    if (!navigator.onLine) return alert('Internet connection is required for Firebase product deletion.');

    showSpinner(true);
    try {
        const access = await ensureFirebaseAccess();
        if (!access.ok) throw new Error(access.error);
        const backupPath = await createFirebaseProductsBackup('before-delete-all-products');
        const now = Date.now();
        const updates = await productSyncChangesCleanupUpdates(now);
        updates.products = null;
        updates['full_backup/products'] = null;
        updates['sync/collectionClears/products'] = { collection: 'products', reason: 'deleteAllProductsMaintenance', clearedAt: now, syncVersion: Number(state.syncVersion) || 0, deviceId: DEVICE_ID };
        updates['maintenance/productsDeletedAt'] = now;
        updates['maintenance/productsDeletedBackupPath'] = backupPath;
        updates['maintenance/productsDedupeVersion'] = PRODUCT_MAINTENANCE_VERSION;

        await db.ref().update(updates);
        state.products = [];
        removeLocalProductSyncArtifacts();
        await clearPendingProductImages();
        await saveToLocal();
        updateAllUI();
        addAdminLog('Firebase product delete', `Deleted all products after backup ${backupPath}`);
        renderProductsMaintenanceReport('All products deleted', { mode, backupPath, deletedProducts: true });
        alert('All products were deleted after a Firebase backup. Other ERP data was not deleted.');
    } catch (error) {
        console.error(error);
        alert('Product deletion failed: ' + explainFirebasePermissionError(error));
    } finally {
        showSpinner(false);
    }
}

async function zeroProductStockMaintenance() {
    const mode = prompt('Type LOCAL to zero stock only on this device, or FIREBASE to zero stock for all devices.');
    if (mode !== 'LOCAL' && mode !== 'FIREBASE') return alert('Cancelled.');
    const typed = prompt('Type ZERO PRODUCT STOCK to confirm. Products will remain; only stock becomes 0.');
    if (typed !== 'ZERO PRODUCT STOCK') return alert('Cancelled.');

    const now = Date.now();
    const zeroedProducts = dedupeProductsSafe(state.products, { source: 'zero-stock-local-base', log: false }).products.map(product => ({
        ...product,
        stock: 0,
        version: (Number(product.version) || 0) + 1,
        _updatedAt: now,
        _deviceId: DEVICE_ID
    }));

    if (mode === 'LOCAL') {
        state.products = zeroedProducts;
        removeLocalProductSyncArtifacts();
        await saveToLocal();
        updateAllUI();
        addAdminLog('Local stock zero', 'Zeroed product stock on this device only. Firebase was not changed.');
        alert('Product stock was zeroed on this device only. Firebase was not changed.');
        return;
    }

    if (!navigator.onLine) return alert('Internet connection is required for Firebase stock zeroing.');

    showSpinner(true);
    try {
        const access = await ensureFirebaseAccess();
        if (!access.ok) throw new Error(access.error);
        const backupPath = await createFirebaseProductsBackup('before-zero-product-stock');
        const [productsSnap, fullBackupProductsSnap] = await Promise.all([
            db.ref('products').once('value'),
            db.ref('full_backup/products').once('value')
        ]);
        const cloudProducts = dedupeProductsSafe(productsSnap.val() || [], { source: 'zero-stock-firebase-base', log: false }).products.map(product => ({
            ...product,
            stock: 0,
            version: (Number(product.version) || 0) + 1,
            _updatedAt: now,
            _deviceId: DEVICE_ID
        }));
        const fullBackupExists = fullBackupProductsSnap.exists();
        const fullBackupProducts = dedupeProductsSafe(fullBackupProductsSnap.val() || [], { source: 'zero-stock-full-backup-base', log: false }).products.map(product => ({
            ...product,
            stock: 0,
            version: (Number(product.version) || 0) + 1,
            _updatedAt: now,
            _deviceId: DEVICE_ID
        }));
        const updates = await productSyncChangesCleanupUpdates(now);
        updates.products = productObjectFromList(cloudProducts);
        if (fullBackupExists) updates['full_backup/products'] = productObjectFromList(fullBackupProducts);
        updates['maintenance/productsStockZeroedAt'] = now;
        updates['maintenance/productsStockZeroBackupPath'] = backupPath;
        updates['maintenance/productsDedupeVersion'] = PRODUCT_MAINTENANCE_VERSION;

        await db.ref().update(updates);
        state.products = cloudProducts;
        removeLocalProductSyncArtifacts();
        await saveToLocal();
        updateAllUI();
        addAdminLog('Firebase stock zero', `Zeroed product stock after backup ${backupPath}`);
        renderProductsMaintenanceReport('Product stock zeroed', { mode, backupPath, totalProducts: cloudProducts.length });
        alert('Product stock was zeroed for all devices after a Firebase backup.');
    } catch (error) {
        console.error(error);
        alert('Stock zeroing failed: ' + explainFirebasePermissionError(error));
    } finally {
        showSpinner(false);
    }
}

async function clearCurrentDeviceData() {
    const typed = prompt('Type CLEAR THIS DEVICE to remove local data, queues, pending images, and PWA caches from this device only.');
    if (typed !== 'CLEAR THIS DEVICE') return alert('Cancelled.');
    const second = confirm('Firebase will NOT be deleted. Continue clearing this device only?');
    if (!second) return;

    showSpinner(true);
    try {
        await createEmergencyBackupFile('before_clear_current_device');
        try { await localforage.clear(); } catch (error) { console.warn('localforage clear failed:', error); }
        const keyPattern = /(abonibal|abn|alfares|wakalat|sync|collection|firebase|localforage|products|erp)/i;
        const exactKeys = new Set([
            SYNC_QUEUE_KEY,
            'abonibalProductionSyncQueueLegacy',
            'largeExcelImportPendingChangesV1',
            SYNC_PENDING_IMAGES_KEY,
            PRODUCTS_REPLACEMENT_MARKER_KEY,
            STORAGE_KEYS.SYNC_VERSION,
            STORAGE_KEYS.LAST_SYNC_TIME
        ]);
        try {
            Object.keys(localStorage).forEach(key => { if (exactKeys.has(key) || keyPattern.test(key)) localStorage.removeItem(key); });
        } catch (error) { console.warn('localStorage cleanup failed:', error); }
        try {
            sessionStorage.clear();
        } catch (error) { console.warn('sessionStorage cleanup failed:', error); }
        try {
            if (window.caches && caches.keys) {
                const names = await caches.keys();
                await Promise.all(names.filter(name => keyPattern.test(name)).map(name => caches.delete(name)));
            }
        } catch (error) { console.warn('cache cleanup failed:', error); }
        try {
            SyncQueue.items = [];
            SyncQueue.processed.clear();
            SyncQueue.save();
        } catch (_) {}
        Object.assign(state, buildEmptyStateObject());
        alert('This device was cleared only. Firebase was not deleted. The page will reload.');
        location.reload();
    } catch (error) {
        console.error(error);
        alert('Current device cleanup failed: ' + (error && error.message ? error.message : String(error)));
    } finally {
        showSpinner(false);
    }
}

// ============================================================
// دوال المسح
// ============================================================
function clearLogs() {
    if (confirm("هل أنت متأكد من مسح سجل النظام بالكامل؟")) {
        state.adminLogs = [];
        saveToLocal();
        renderAdminLogs();
        alert("✅ تم مسح سجل النظام");
    }
}

function clearSafeTransactions() {
    if (confirm("هل أنت متأكد من مسح سجل حركات الصندوق بالكامل؟")) {
        state.safeTransactions = [];
        saveToLocal();
        renderSafeTransactions();
        alert("✅ تم مسح سجل حركات الصندوق");
    }
}

function clearLedger() {
    if (confirm("هل أنت متأكد من مسح سجل دفتر الأستاذ العام بالكامل؟")) {
        state.ledgerEntries = [];
        saveToLocal();
        renderLedgerEntries();
        alert("✅ تم مسح سجل دفتر الأستاذ");
    }
}

// ============================================================
// تحديث جميع الواجهات
// ============================================================
function updateAllUI() {
    normalizeStateForLegacyData();
    if (!Array.isArray(state.categories) || state.categories.length === 0) state.categories = ["إطارات", "محركات", "اكسسوارات"];
    safeUI('categories', updateCategoriesUI);
    safeUI('products', updateProductsUI);
    safeUI('shortages', updateShortagesUI);
    safeUI('expenses', updateExpensesUI);
    safeUI('clients', updateClientsUI);
    safeUI('suppliers', updateSuppliersUI);
    safeUI('retailSales', updateRetailSalesUI);
    safeUI('invoices', updateInvoicesListUI);
    safeUI('exchanges', updateExchangeUI);
    safeUI('rates', updateRatesUI);
    safeUI('partners', updatePartnersUI);
    safeUI('adminLogs', renderAdminLogs);
    safeUI('safeTransactions', renderSafeTransactions);
    safeUI('ledgerEntries', renderLedgerEntries);
    safeUI('dashboard', calculateDashboard);
    safeUI('metaBar', updateLiveMetaBar);
    updateSyncStatus('✅ متزامن');
}

// ============================================================
// تهيئة التطبيق
// ============================================================
async function initApp() {
    showSpinner(true);
    await loadFromLocal();

    try {
        state.clients.forEach(c => { if (c && !c.id) c.id = generateUniqueID(); });
        state.suppliers.forEach(s => { if (s && !s.id) s.id = generateUniqueID(); });
        state.products.forEach(p => { if (p && !p.version) p.version = 1; });
    } catch (e) { console.error(e); }

    await ensureFirebaseAccess();
    checkConnection();
    if (!connectionListenerRegistered) {
        window.__ABN_NET_ONLINE_HANDLER__ = window.__ABN_NET_ONLINE_HANDLER__ || function abnNetworkOnlineHandler() {
            checkConnection();
            if (window.ABNRuntimeStability && typeof window.ABNRuntimeStability.requestSync === 'function') {
                window.ABNRuntimeStability.requestSync('network-online');
            } else {
                SyncManager.performDeltaSync();
            }
        };
        window.__ABN_NET_OFFLINE_HANDLER__ = window.__ABN_NET_OFFLINE_HANDLER__ || function abnNetworkOfflineHandler() { checkConnection(); };
        window.removeEventListener('online', window.__ABN_NET_ONLINE_HANDLER__);
        window.removeEventListener('offline', window.__ABN_NET_OFFLINE_HANDLER__);
        window.addEventListener('online', window.__ABN_NET_ONLINE_HANDLER__);
        window.addEventListener('offline', window.__ABN_NET_OFFLINE_HANDLER__);
        connectionListenerRegistered = true;
    }

    /*db.ref('sync/changes').orderByChild('timestamp').limitToLast(50).on('child_added', (snapshot) => {
        const change = snapshot.val();
        if (change && !change.synced) {
            SyncManager.applyRemoteChange(change);
            updateAllUI();
        }
    });*/

    if (!syncIntervalId) {
        syncIntervalId = setInterval(() => {
            if (navigator.onLine && !isSyncing) {
                SyncManager.performDeltaSync();
            }
        }, 30000);
    }

    updateAllUI();
    showSpinner(false);
    console.log('✅ ABONIBAL ERP - النظام جاهز!');
    console.log(`📦 المنتجات: ${state.products.length}`);
    console.log(`📊 القيود المحاسبية: ${state.ledgerEntries.length}`);
    console.log(`🔄 إصدار المزامنة: ${state.syncVersion}`);
}


// ============================================================
// PATCH-002 — Engineering Stabilization & Hardening
// ============================================================
const PATCH_002_VERSION = 'PATCH-002_SYNC_DATA_SECURITY_HARDENING';
const COLLECTION_CLEAR_MARKS_KEY = 'abonibalProductionCollectionClearMarksV2';
const PATCH002_ARRAY_COLLECTIONS = [
    'products', 'clients', 'invoices', 'retailSales', 'expenses', 'suppliers',
    'partnerWithdrawals', 'capitalRecords', 'exchanges', 'itemTracks',
    'safeTransactions', 'ledgerEntries', 'adminLogs'
];

const __patch002OriginalNormalize = normalizeStateForLegacyData;
normalizeStateForLegacyData = function() {
    __patch002OriginalNormalize();
    PATCH002_ARRAY_COLLECTIONS.forEach(collection => { state[collection] = forceArray(state[collection]); });
};

function getCollectionClearMarks() {
    return safeJsonParse(localStorage.getItem(COLLECTION_CLEAR_MARKS_KEY), {});
}

function setCollectionClearMark(collection, versionOrTime) {
    const marks = getCollectionClearMarks();
    marks[collection] = Math.max(Number(marks[collection] || 0), Number(versionOrTime || Date.now()));
    localStorage.setItem(COLLECTION_CLEAR_MARKS_KEY, JSON.stringify(marks));
}

function trackCollectionClear(collection, reason = '') {
    const now = Date.now();
    setCollectionClearMark(collection, now);
    SyncQueue.add({
        id: generateUniqueID(),
        collection,
        entityId: '__all__',
        operation: 'clearCollection',
        data: { collection, reason, clearedAt: now, _updatedAt: now, _deviceId: DEVICE_ID },
        timestamp: now,
        localSeq: now,
        deviceId: DEVICE_ID,
        synced: false
    });
    scheduleDeltaSync();
}

function applyCloudDeletionState(syncData) {
    if (!syncData) return;
    const deletions = syncData.deletions || {};
    Object.keys(deletions).forEach(collection => {
        if (!Array.isArray(state[collection])) return;
        const ids = new Set(Object.keys(deletions[collection] || {}).map(String));
        if (ids.size) state[collection] = state[collection].filter(item => item && !ids.has(String(item.id)));
    });

    const clears = syncData.collectionClears || {};
    Object.keys(clears).forEach(collection => {
        if (!Array.isArray(state[collection])) return;
        const clearInfo = clears[collection];
        const clearStamp = (typeof clearInfo === 'number')
            ? clearInfo
            : Number((clearInfo && (clearInfo.syncVersion || clearInfo.clearedAt || clearInfo.timestamp)) || 0);
        const marks = getCollectionClearMarks();
        if (clearStamp && clearStamp >= Number(marks[collection] || 0)) {
            state[collection] = [];
            setCollectionClearMark(collection, clearStamp || Date.now());
        }
    });
}

const __patch002OriginalBuildUpdates = SyncManager.buildUpdates;
SyncManager.buildUpdates = function(changes) {
    const updates = {};
    activeProductSyncChanges(changes).forEach(change => {
        updates[`sync/changes/${change.id}`] = change;

        if (change.operation === 'clearCollection') {
            updates[change.collection] = null;
            updates[`sync/collectionClears/${change.collection}`] = {
                collection: change.collection,
                reason: change.data && change.data.reason || '',
                clearedAt: change.timestamp,
                syncVersion: change.syncVersion,
                deviceId: change.deviceId
            };
            return;
        }

        const path = rootPathForChange(change);
        if (path) updates[path] = change.operation === 'delete' ? null : change.data;
        if (change.operation === 'delete') {
            updates[`sync/deletions/${change.collection}/${change.entityId}`] = {
                id: change.entityId,
                collection: change.collection,
                deletedAt: change.timestamp,
                syncVersion: change.syncVersion,
                deviceId: change.deviceId
            };
        }
    });
    updates['sync/lastSyncTime'] = Date.now();
    return updates;
};

const __patch002OriginalApplyRemoteChange = SyncManager.applyRemoteChange;
SyncManager.applyRemoteChange = async function(change) {
    if (!change || !change.id || !change.collection) return false;

    if (change.operation === 'clearCollection') {
        if (change.deviceId === DEVICE_ID) {
            state.syncVersion = Math.max(Number(state.syncVersion) || 0, Number(change.syncVersion) || 0);
            return false;
        }
        if (Array.isArray(state[change.collection])) {
            state[change.collection] = [];
            setCollectionClearMark(change.collection, change.syncVersion || change.timestamp || Date.now());
            state.syncVersion = Math.max(Number(state.syncVersion) || 0, Number(change.syncVersion) || 0);
            state.lastSyncTime = Date.now();
            await saveToLocal();
            return true;
        }
        return false;
    }

    return __patch002OriginalApplyRemoteChange(change);
};

SyncManager.finalizeSync = async function () {
    const access = await ensureFirebaseAccess();
    if (!access.ok) throw new Error('تعذر الوصول إلى Firebase: ' + access.error);
    const now = Date.now();
    state.lastSyncTime = now;
    const localVersion = Number(state.syncVersion) || 0;
    await db.ref('sync/lastSyncVersion').transaction(current => Math.max(Number(current) || 0, localVersion));
    await db.ref().update({
        'sync/lastSyncTime': now,
        'lastSyncTime': now,
        'syncVersion': localVersion
    });
    if (localVersion && localVersion % 25 === 0) {
        await db.ref('full_backup').set({ ...buildCloudStateSnapshot(), backupTime: now });
    }
    await saveToLocal();
};

SyncManager.uploadFullStateSnapshot = async function(reason = 'full-state') {
    if (!navigator.onLine) return { success: false, error: 'لا يوجد اتصال بالإنترنت' };
    const access = await ensureFirebaseAccess();
    if (!access.ok) throw new Error('تعذر الوصول إلى Firebase: ' + access.error);
    const snapshot = buildCloudStateSnapshot();
    snapshot.sync = {
        ...(snapshot.sync || {}),
        lastSyncVersion: Number(state.syncVersion) || 0,
        lastSyncTime: Date.now(),
        fullStateReason: reason
    };
    await db.ref().update(snapshot);
    return { success: true };
};

async function pullFromCloud() {
    const btn = document.getElementById('pull-btn-ui');
    if (btn) { btn.innerText = '⏳ جاري...'; btn.disabled = true; }
    try {
        const access = await ensureFirebaseAccess();
        if (!access.ok) throw new Error('تعذر الوصول إلى Firebase: ' + access.error);
        const snapshot = await db.ref().once('value');
        const data = snapshot.val();
        if (!data) return alert('⚠️ السحابة فارغة.');

        if (data.maintenance) writeProductsReplacementMarker(data.maintenance);
        replaceProductsFromSource(data.products !== undefined ? data.products : (data.full_backup && data.full_backup.products) || [], 'pullFromCloud');
        if (data.categories) state.categories = forceArray(data.categories);
        if (data.clients) state.clients = mergeById(state.clients, forceArray(data.clients));
        if (data.suppliers) state.suppliers = mergeById(state.suppliers, forceArray(data.suppliers));
        if (data.expenses) state.expenses = mergeById(state.expenses, forceArray(data.expenses));
        if (data.invoices) state.invoices = mergeById(state.invoices, forceArray(data.invoices));
        if (data.retailSales) state.retailSales = mergeById(state.retailSales, forceArray(data.retailSales));
        if (data.itemTracks) state.itemTracks = mergeById(state.itemTracks, forceArray(data.itemTracks));
        if (data.rates) state.rates = data.rates;
        if (data.safes) state.safes = data.safes;
        if (data.exchanges) state.exchanges = mergeById(state.exchanges, forceArray(data.exchanges));
        if (data.partnerWithdrawals) state.partnerWithdrawals = mergeById(state.partnerWithdrawals, forceArray(data.partnerWithdrawals));
        if (data.capitalRecords) state.capitalRecords = mergeById(state.capitalRecords, forceArray(data.capitalRecords));
        if (data.ledgerEntries) state.ledgerEntries = mergeById(state.ledgerEntries, forceArray(data.ledgerEntries));
        if (data.adminLogs) state.adminLogs = mergeById(state.adminLogs, forceArray(data.adminLogs));
        if (data.safeTransactions) state.safeTransactions = mergeById(state.safeTransactions, forceArray(data.safeTransactions));
        if (data.invoiceCount) state.invoiceCount = Math.max(Number(state.invoiceCount)||0, Number(data.invoiceCount)||0);
        applyCloudDeletionState(data.sync || {});
        state.syncVersion = Math.max(Number(state.syncVersion)||0, Number(data.syncVersion)||0, Number(data.sync && data.sync.lastSyncVersion)||0);
        state.lastSyncTime = data.lastSyncTime || Date.now();
        normalizeStateForLegacyData();
        await saveToLocal();
        updateAllUI();
        alert('✅ تم استرجاع البيانات من السحابة بنجاح!');
    } catch (error) {
        console.error(error);
        alert('❌ حدث خطأ أثناء جلب البيانات.\n' + explainFirebasePermissionError(error));
    } finally {
        if (btn) { btn.innerText = '🔽 استرجاع'; btn.disabled = false; }
    }
}

async function createEmergencyBackupFile(reason = 'backup') {
    try {
        const backup = { ...state, backupReason: reason, backupTime: new Date().toISOString(), patch: PATCH_002_VERSION };
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ABONIBAL_BACKUP_${reason}_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (error) {
        console.warn('Backup file creation failed:', error);
    }
}

function buildEmptyStateObject() {
    return {
        categories: ['إطارات', 'محركات', 'اكسسوارات'],
        products: [], expenses: [], clients: [], suppliers: [], retailSales: [], invoices: [], itemTracks: [],
        partnerWithdrawals: [], exchanges: [], capitalRecords: [], adminLogs: [], safeTransactions: [], ledgerEntries: [],
        invoiceCount: 150,
        rates: { try: 0, syp: 0 },
        safes: { usd: 0, try: 0, syp: 0 },
        lastSyncTime: Date.now(),
        syncVersion: 0};
}

function buildEmptyCloudState() {
    const empty = buildEmptyStateObject();
    const clearedAt = Date.now();
    const collectionClears = {};
    PATCH002_ARRAY_COLLECTIONS.forEach(collection => { collectionClears[collection] = { collection, reason: 'wipeApplication', clearedAt, syncVersion: 0, deviceId: DEVICE_ID }; });
    return {
        products: {}, clients: {}, invoices: {}, retailSales: {}, expenses: {}, suppliers: {}, partnerWithdrawals: {}, capitalRecords: {},
        exchanges: {}, itemTracks: {}, safeTransactions: {}, ledgerEntries: {}, adminLogs: {},
        categories: empty.categories,
        rates: empty.rates,
        safes: empty.safes,
        invoiceCount: empty.invoiceCount,
        lastSyncTime: clearedAt,
        syncVersion: 0,
        sync: { changes: {}, deletions: {}, collectionClears, lastSyncVersion: 0, lastSyncTime: clearedAt, resetAt: clearedAt, resetBy: DEVICE_ID },
        full_backup: null
    };
}

async function wipeApplication() {
    if (!confirm('⚠️ تحذير خطير: سيتم تبييض التطبيق ومسح كل البيانات محلياً ومن السحابة. هل تريد المتابعة؟')) return;
    if (!confirm('تأكيد نهائي: لا يمكن التراجع إلا إذا كانت لديك نسخة احتياطية. هل أنت متأكد؟')) return;
    const typed = prompt('للتأكيد اكتب DELETE أو حذف');
    if (typed !== 'DELETE' && typed !== 'حذف') return alert('تم إلغاء العملية.');
    if (!navigator.onLine) return alert('يجب وجود اتصال بالإنترنت لتبييض التطبيق حتى تُمسح السحابة أيضاً.');

    showSpinner(true);
    updateSyncStatus('🧹 جاري تبييض التطبيق...');
    try {
        await createEmergencyBackupFile('before_wipe');
        const access = await ensureFirebaseAccess();
        if (!access.ok) throw new Error('تعذر الوصول إلى Firebase: ' + access.error);
        await db.ref().set(buildEmptyCloudState());
        await localforage.clear();
        [SYNC_QUEUE_KEY, 'abonibalProductionSyncQueueLegacy', SYNC_PENDING_IMAGES_KEY, COLLECTION_CLEAR_MARKS_KEY].forEach(k => localStorage.removeItem(k));
        Object.assign(state, buildEmptyStateObject());
        SyncQueue.items = [];
        SyncQueue.processed.clear();
        await saveToLocal();
        updateAllUI();
        if (window.ABNAuth && typeof window.ABNAuth.logout === 'function') await window.ABNAuth.logout();
        alert('✅ تم مسح بيانات التطبيق. تتم المصادقة فقط عبر Firebase Auth.');
    } catch (error) {
        console.error(error);
        alert('❌ فشل تبييض التطبيق: ' + explainFirebasePermissionError(error));
    } finally {
        showSpinner(false);
        updateSyncStatus('✅ متزامن');
    }
}

const __patch002OriginalClearLogs = clearLogs;
clearLogs = async function() {
    if (!confirm('هل أنت متأكد من مسح سجل النظام بالكامل؟')) return;
    state.adminLogs = [];
    trackCollectionClear('adminLogs', 'clearLogs');
    await saveToLocal();
    renderAdminLogs();
    if (navigator.onLine) await SyncManager.performDeltaSync();
    alert('✅ تم مسح سجل النظام ومزامنة المسح');
};

clearSafeTransactions = async function() {
    if (!confirm('هل أنت متأكد من مسح سجل حركات الصندوق بالكامل؟')) return;
    state.safeTransactions = [];
    trackCollectionClear('safeTransactions', 'clearSafeTransactions');
    await saveToLocal();
    renderSafeTransactions();
    if (navigator.onLine) await SyncManager.performDeltaSync();
    alert('✅ تم مسح سجل حركات الصندوق ومزامنة المسح');
};

clearLedger = async function() {
    if (!confirm('هل أنت متأكد من مسح سجل دفتر الأستاذ العام بالكامل؟')) return;
    state.ledgerEntries = [];
    trackCollectionClear('ledgerEntries', 'clearLedger');
    await saveToLocal();
    renderLedgerEntries();
    if (navigator.onLine) await SyncManager.performDeltaSync();
    alert('✅ تم مسح دفتر الأستاذ ومزامنة المسح');
};

const __patch002OriginalSaveCategory = saveCategory;
saveCategory = function() {
    const before = JSON.stringify(state.categories || []);
    __patch002OriginalSaveCategory();
    if (before !== JSON.stringify(state.categories || [])) {
        trackChange('categories', 'categories', 'update', state.categories);
        if (navigator.onLine) SyncManager.performDeltaSync();
    }
};

const __patch002OriginalDeleteCategory = deleteCategory;
deleteCategory = function(catName) {
    const before = JSON.stringify(state.categories || []);
    __patch002OriginalDeleteCategory(catName);
    if (before !== JSON.stringify(state.categories || [])) {
        trackChange('categories', 'categories', 'update', state.categories);
        if (navigator.onLine) SyncManager.performDeltaSync();
    }
};

async function compressImageForUpload(fileOrBlob) {
    try {
        let source = fileOrBlob;
        const name = String(fileOrBlob.name || '').toLowerCase();
        const type = String(fileOrBlob.type || '').toLowerCase();
        if ((name.endsWith('.heic') || name.endsWith('.heif') || type.includes('heic') || type.includes('heif')) && typeof heic2any !== 'undefined') {
            source = await heic2any({ blob: fileOrBlob, toType: 'image/jpeg', quality: 0.82 });
        }
        const bitmap = await createImageBitmap(source);
        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.78));
    } catch (error) {
        console.warn('Image compression fallback:', error);
        return fileOrBlob;
    }
}

const __patch002OriginalUploadImageToCloudinary = uploadImageToCloudinary;
uploadImageToCloudinary = async function(imageFile) {
    const optimized = await compressImageForUpload(imageFile);
    return __patch002OriginalUploadImageToCloudinary(optimized || imageFile);
};

function normalizeImportedState(imported) {
    const clean = buildEmptyStateObject();
    if (!imported || typeof imported !== 'object') throw new Error('INVALID_BACKUP');
    PATCH002_ARRAY_COLLECTIONS.forEach(collection => { clean[collection] = forceArray(imported[collection]); });
    clean.products = dedupeProductsSafe(clean.products, { source: 'importBackup', log: false }).products;
    clean.categories = forceArray(imported.categories).length ? forceArray(imported.categories) : clean.categories;
    clean.rates = { try: Number(imported.rates && imported.rates.try) || 0, syp: Number(imported.rates && imported.rates.syp) || 0 };
    clean.safes = { usd: Number(imported.safes && imported.safes.usd) || 0, try: Number(imported.safes && imported.safes.try) || 0, syp: Number(imported.safes && imported.safes.syp) || 0 };
    clean.invoiceCount = Math.max(150, Number(imported.invoiceCount) || 150);
    clean.syncVersion = Number(imported.syncVersion) || 0;
    clean.lastSyncTime = Number(imported.lastSyncTime) || Date.now();
    return clean;
}

importBackup = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            await createEmergencyBackupFile('before_import');
            const importedState = normalizeImportedState(JSON.parse(e.target.result));
            Object.assign(state, importedState);
            normalizeStateForLegacyData();
            await saveToLocal();
            updateAllUI();
            if (navigator.onLine && confirm('هل تريد رفع النسخة المستعادة إلى السحابة الآن؟')) {
                await SyncManager.uploadFullStateSnapshot('importBackup');
            }
            alert('✅ تمت استعادة النسخة الاحتياطية بنجاح!');
            addAdminLog('استعادة نسخة', 'تمت استعادة البيانات من ملف احتياطي بعد التحقق منها');
        } catch (err) {
            console.error(err);
            alert('❌ فشل في قراءة أو التحقق من ملف النسخة الاحتياطية');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(file);
};

const __patch002OriginalUpdateAllUI = updateAllUI;
updateAllUI = function() {
    normalizeStateForLegacyData();
    applyCloudDeletionState({ collectionClears: getCollectionClearMarks() });
    __patch002OriginalUpdateAllUI();
};

console.log('✅ PATCH-002 hardening layer loaded');

// ============================================================
// جاهزية DOM
// ============================================================
function bindProductPriceAutoFillP2() {
    const costInput = document.getElementById('prod-cost');
    const wholesaleInput = document.getElementById('prod-wholesale');
    const retailInput = document.getElementById('prod-retail');

    if (costInput && wholesaleInput && retailInput && costInput.dataset.abnPriceAutoFillBound !== '1') {
        window.__ABN_PRICE_AUTOFILL_HANDLER__ = window.__ABN_PRICE_AUTOFILL_HANDLER__ || function abnProductCostAutoFill() {
            const cost = parseFloat(this.value);
            if (isNaN(cost)) return;
            wholesaleInput.value = parseFloat((cost * 1.20).toFixed(2));
            retailInput.value = parseFloat((cost * 1.30).toFixed(2));
        };
        costInput.addEventListener('input', window.__ABN_PRICE_AUTOFILL_HANDLER__);
        costInput.dataset.abnPriceAutoFillBound = '1';
    }
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindProductPriceAutoFillP2, { once: true });
} else {
    bindProductPriceAutoFillP2();
}

// ============================================================
// Service Worker
// ============================================================
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.__ABN_SW_REGISTER_HANDLER__ = window.__ABN_SW_REGISTER_HANDLER__ || function abnRegisterServiceWorker() {
        navigator.serviceWorker.register('./sw.js')
            .catch(error => console.log('SW Registration Failed', error));
    };
    window.removeEventListener('load', window.__ABN_SW_REGISTER_HANDLER__);
    window.addEventListener('load', window.__ABN_SW_REGISTER_HANDLER__, { once: true });
}

// ============================================================
// معالجة الأخطاء العامة
// ============================================================
if (!window.__ABN_GLOBAL_ERROR_HANDLER__) {
    window.__ABN_GLOBAL_ERROR_HANDLER__ = function abnGlobalErrorHandler(e) { console.error('Global Error:', e.error); };
    window.addEventListener('error', window.__ABN_GLOBAL_ERROR_HANDLER__);
}
if (!window.__ABN_GLOBAL_REJECTION_HANDLER__) {
    window.__ABN_GLOBAL_REJECTION_HANDLER__ = function abnGlobalRejectionHandler(e) { console.error('Promise Error:', e.reason); };
    window.addEventListener('unhandledrejection', window.__ABN_GLOBAL_REJECTION_HANDLER__);
}

console.log('✅ ABONIBAL ERP - النظام المحاسبي المتكامل جاهز!');
console.log('📊 القيد المزدوج مفعل، المزامنة التفاضلية مفعلة.');
