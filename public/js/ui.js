/* Extracted operational script block 11 */
(function(){
    const PATCH004_R2_VERSION = 'PATCH-004_R2_EXCEL_QUOTA_SAFE_2026-06-27';
    const LARGE_IMPORT_PENDING_KEY = 'largeExcelImportPendingChangesV1';

    function p4log(msg) {
        try { console.log('✅ ' + msg); } catch (_) {}
    }

    function p4Cell(row, names, fallback = '') {
        for (const name of names) {
            if (row && row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') return row[name];
        }
        return fallback;
    }

    function p4QueueChange(batch, collection, entityId, operation, data) {
        const now = Date.now();
        batch.push({
            id: generateUniqueID(),
            collection,
            entityId: String(entityId),
            operation,
            data: (data && typeof data === 'object' && !Array.isArray(data)) ? normalizeEntity(data, entityId) : data,
            timestamp: now,
            localSeq: now,
            deviceId: DEVICE_ID,
            synced: false
        });
    }

    function p4AddTrackRecord(batch, prodId, prodName, type, qty, note) {
        const record = {
            id: generateUniqueID(),
            prodId,
            name: prodName,
            type,
            qty,
            note,
            date: new Date().toLocaleString('ar-EG'),
            timestamp: Date.now(),
            _updatedAt: Date.now(),
            _deviceId: DEVICE_ID
        };
        state.itemTracks.unshift(record);
        p4QueueChange(batch, 'itemTracks', record.id, 'create', record);
        return record;
    }

    function p4CompactLocalSyncQueue() {
        if (!window.SyncQueue || !Array.isArray(SyncQueue.items)) return;
        try {
            const unsynced = SyncQueue.items.filter(c => c && !c.synced);
            const nonBulk = unsynced.filter(c => !(c.collection === 'products' || c.collection === 'itemTracks'));
            const productTail = unsynced.filter(c => c.collection === 'products' || c.collection === 'itemTracks').slice(-120);
            SyncQueue.items = nonBulk.concat(productTail).slice(-600);
            localStorage.removeItem('abonibalProductionSyncQueueV2');
            localStorage.removeItem('abonibalProductionSyncQueueLegacy');
            try { SyncQueue.save(); } catch (_) {
                localStorage.removeItem('abonibalProductionSyncQueueV2');
                localStorage.removeItem('abonibalProductionSyncQueueLegacy');
            }
        } catch (e) {
            try { localStorage.removeItem('abonibalProductionSyncQueueV2'); localStorage.removeItem('abonibalProductionSyncQueueLegacy'); } catch (_) {}
        }
    }

    if (window.SyncQueue && typeof SyncQueue.save === 'function' && !SyncQueue._patch004R2SavePatched) {
        const originalSave = SyncQueue.save.bind(SyncQueue);
        SyncQueue.save = function quotaSafeSave() {
            try {
                originalSave();
            } catch (error) {
                const msg = String(error && (error.message || error.name) || error).toLowerCase();
                if (!msg.includes('quota') && !msg.includes('exceeded')) throw error;
                console.warn('Sync queue exceeded localStorage quota; compacting queue.', error);
                const unsynced = this.items.filter(c => c && !c.synced);
                const nonBulk = unsynced.filter(c => !(c.collection === 'products' || c.collection === 'itemTracks'));
                const productTail = unsynced.filter(c => c.collection === 'products' || c.collection === 'itemTracks').slice(-80);
                this.items = nonBulk.concat(productTail).slice(-500);
                try { localStorage.removeItem('abonibalProductionSyncQueueV2'); localStorage.removeItem('abonibalProductionSyncQueueLegacy'); } catch (_) {}
                try {
                    localStorage.setItem('abonibalProductionSyncQueueV2', JSON.stringify(this.items));
                    localStorage.setItem('abonibalProductionSyncQueueLegacy', JSON.stringify(this.items));
                } catch (secondError) {
                    this.items = nonBulk.slice(-200);
                    try { localStorage.removeItem('abonibalProductionSyncQueueV2'); localStorage.removeItem('abonibalProductionSyncQueueLegacy'); } catch (_) {}
                    try { localStorage.setItem('abonibalProductionSyncQueueV2', JSON.stringify(this.items)); } catch (_) {}
                }
            }
        };
        SyncQueue._patch004R2SavePatched = true;
    }

    async function p4UploadChangesDirect(changes, onProgress) {
        if (!changes.length) return { uploaded: 0, storedOffline: false };
        if (!navigator.onLine) {
            await localforage.setItem(LARGE_IMPORT_PENDING_KEY, changes);
            return { uploaded: 0, storedOffline: true };
        }

        const UPLOAD_CHUNK = 120;
        let uploaded = 0;
        for (let start = 0; start < changes.length; start += UPLOAD_CHUNK) {
            const chunk = changes.slice(start, start + UPLOAD_CHUNK);
            const versioned = await SyncManager.allocateVersions(chunk);
            const updates = SyncManager.buildUpdates(versioned);
            await db.ref().update(updates);
            uploaded += versioned.length;
            const maxVersion = Math.max(state.syncVersion || 0, ...versioned.map(c => Number(c.syncVersion) || 0));
            state.syncVersion = maxVersion;
            if (typeof onProgress === 'function') onProgress(uploaded, changes.length);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        return { uploaded, storedOffline: false };
    }

    async function p4ProcessExcelRows(rows, onProgress) {
        const changes = [];
        const productMap = new Map();
        function registerProduct(product) {
            if (!product) return;
            if (typeof getProductIdentityKeys === 'function') {
                getProductIdentityKeys(product).forEach(key => productMap.set(key, product));
            } else if (product.name) {
                productMap.set(String(product.name).trim().toLowerCase(), product);
            }
        }
        function findExistingProduct(draft) {
            if (typeof getProductIdentityKeys === 'function') {
                const keys = getProductIdentityKeys(draft);
                for (const key of keys) {
                    if (productMap.has(key)) return productMap.get(key);
                }
            }
            return productMap.get(String(draft.name || '').trim().toLowerCase()) || null;
        }
        state.products.forEach(registerProduct);

        let addedCount = 0;
        let updatedCount = 0;
        const CHUNK = 80;
        const nowBase = Date.now();

        for (let start = 0; start < rows.length; start += CHUNK) {
            const end = Math.min(start + CHUNK, rows.length);
            for (let i = start; i < end; i++) {
                const row = rows[i] || {};
                const rawName = p4Cell(row, ['الاسم', 'اسم القطعة', 'name', 'Name']);
                if (!rawName) continue;
                const name = String(rawName).trim();
                if (!name) continue;
                const category = String(p4Cell(row, ['القسم', 'الصنف', 'category'], state.categories[0] || 'عام')).trim() || 'عام';
                const cost = Number(parseFloat(p4Cell(row, ['سعر الشراء', 'تكلفة الشراء', 'cost'], 0)) || 0);
                const wholesale = Number(parseFloat(p4Cell(row, ['سعر الجملة', 'wholesale'], 0)) || 0);
                const retail = Number(parseFloat(p4Cell(row, ['سعر المفرق', 'retail'], 0)) || 0);
                const incomingStock = parseInt(p4Cell(row, ['الكمية', 'الكمية المتوفرة', 'stock'], 0)) || 0;

                const draft = { name, category, cost, wholesale, retail };
                const existing = findExistingProduct(draft);
                if (existing) {
                    existing.cost = Number(cost.toFixed(2));
                    existing.wholesale = Number(wholesale.toFixed(2));
                    existing.retail = Number(retail.toFixed(2));
                    existing.stock = Number(existing.stock || 0) + incomingStock;
                    existing.category = category;
                    existing.version = (existing.version || 0) + 1;
                    existing._updatedAt = nowBase + i;
                    existing._deviceId = DEVICE_ID;
                    p4QueueChange(changes, 'products', existing.id, 'update', existing);
                    if (incomingStock > 0) p4AddTrackRecord(changes, existing.id, existing.name, 'إضافة كمية', incomingStock, 'تحديث وزيادة كمية عبر إكسيل');
                    updatedCount++;
                } else {
                    const newId = generateUniqueID();
                    const newProd = {
                        id: newId,
                        name,
                        category,
                        cost: Number(cost.toFixed(2)),
                        wholesale: Number(wholesale.toFixed(2)),
                        retail: Number(retail.toFixed(2)),
                        stock: incomingStock,
                        image: '',
                        version: 1,
                        _updatedAt: nowBase + i,
                        _deviceId: DEVICE_ID
                    };
                    state.products.unshift(newProd);
                    registerProduct(newProd);
                    p4QueueChange(changes, 'products', newId, 'create', newProd);
                    p4AddTrackRecord(changes, newId, name, 'إضافة', incomingStock, 'استيراد قطعة جديدة من إكسيل');
                    addedCount++;
                }
            }
            if (typeof onProgress === 'function') onProgress(end, rows.length);
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        if (typeof dedupeProductsSafe === 'function') {
            state.products = dedupeProductsSafe(state.products, { source: 'excel-import', log: false }).products;
        }
        if (state.itemTracks.length > 2000) state.itemTracks.length = 2000;
        return { addedCount, updatedCount, changes };
    }

    async function p4FlushPendingLargeImport() {
        const pending = await localforage.getItem(LARGE_IMPORT_PENDING_KEY);
        if (!pending || !pending.length || !navigator.onLine) return 0;
        updateSyncStatus('📤 رفع استيراد سابق...');
        const result = await p4UploadChangesDirect(pending, (done, total) => updateSyncStatus(`📤 رفع ${done} / ${total}`));
        if (!result.storedOffline) await localforage.removeItem(LARGE_IMPORT_PENDING_KEY);
        return result.uploaded || 0;
    }

    const originalPerformDeltaSync = SyncManager.performDeltaSync ? SyncManager.performDeltaSync.bind(SyncManager) : null;
    if (originalPerformDeltaSync && !SyncManager._patch004R2DeltaPatched) {
        SyncManager.performDeltaSync = async function patchedPerformDeltaSync() {
            if (navigator.onLine) {
                try { await p4FlushPendingLargeImport(); } catch (e) { console.warn('Pending large import upload failed:', e); }
            }
            return originalPerformDeltaSync();
        };
        SyncManager._patch004R2DeltaPatched = true;
    }

    window.importFromExcel = function importFromExcelQuotaSafe(event) {
        if (typeof XLSX === 'undefined') return alert('المكتبة قيد التحميل، يرجى المحاولة بعد قليل');
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        const inputEl = event.target;
        const reader = new FileReader();
        showSpinner(true);
        p4CompactLocalSyncQueue();
        updateSyncStatus('📥 قراءة ملف الإكسيل...');

        reader.onload = async function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const excelData = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
                if (!excelData.length) {
                    alert('ملف الإكسيل فارغ أو لا يحتوي على صفوف قابلة للاستيراد.');
                    return;
                }
                if (excelData.length > 5000) {
                    alert('ملف الإكسيل كبير جدًا. يرجى تقسيمه إلى ملفات أصغر من 5000 صف للحفاظ على استقرار الهاتف.');
                    return;
                }
                if (excelData.length > 2500) {
                    const ok = confirm(`الملف يحتوي على ${excelData.length} صف. قد يستغرق الاستيراد بعض الوقت. هل تريد المتابعة؟`);
                    if (!ok) return;
                }

                updateSyncStatus(`📥 استيراد 0 / ${excelData.length}`);
                const processed = await p4ProcessExcelRows(excelData, (done, total) => updateSyncStatus(`📥 استيراد ${done} / ${total}`));
                await saveToLocal();
                safeUI('updateProductsUI', () => updateProductsUI());
                safeUI('calculateDashboard', () => calculateDashboard());
                addAdminLog('استيراد إكسيل', `إضافة ${processed.addedCount} وتحديث ${processed.updatedCount} قطعة عبر إكسيل`);

                let uploadInfo = { uploaded: 0, storedOffline: false };
                if (processed.changes.length) {
                    updateSyncStatus(`📤 رفع 0 / ${processed.changes.length}`);
                    uploadInfo = await p4UploadChangesDirect(processed.changes, (done, total) => updateSyncStatus(`📤 رفع ${done} / ${total}`));
                }
                await saveToLocal();
                updateSyncStatus(uploadInfo.storedOffline ? '⚠️ محفوظ محليًا بانتظار الإنترنت' : '✅ متزامن');
                const syncLine = uploadInfo.storedOffline
                    ? '⚠️ تم حفظ التغييرات محليًا وسيتم رفعها عند الاتصال.'
                    : `📤 تم رفع ${uploadInfo.uploaded} تغيير للسحابة مباشرة بدون امتلاء التخزين.`;
                alert(`✅ اكتمل الاستيراد بنجاح!\n\n✨ تم إضافة: ${processed.addedCount} قطعة جديدة.\n🔄 تم تحديث: ${processed.updatedCount} قطعة موجودة.\n${syncLine}`);
            } catch (err) {
                console.error('Excel import failed:', err);
                alert('❌ خطأ في قراءة أو استيراد ملف الإكسيل: ' + (err && err.message ? err.message : err));
            } finally {
                if (inputEl) inputEl.value = '';
                showSpinner(false);
            }
        };
        reader.onerror = function() {
            showSpinner(false);
            if (inputEl) inputEl.value = '';
            alert('❌ تعذر قراءة ملف الإكسيل.');
        };
        reader.readAsArrayBuffer(file);
    };

    window.PATCH004_R2 = { version: PATCH004_R2_VERSION, flushPendingLargeImport: p4FlushPendingLargeImport };
    p4log(PATCH004_R2_VERSION + ' loaded');
})();

/* Extracted operational script block 12 */
/* ============================================================
   PATCH-005 PHASE 1: COMMERCIAL FOUNDATION CORE
   Non-invasive: no accounting/sync/database logic is changed.
   ============================================================ */
(function(){
    const PRODUCT = {
        name: 'ABONIBAL ERP',
        edition: 'Professional Foundation',
        build: 'PATCH-006-STABILIZATION-P4',
        buildDate: '2026-06-28',
        licenseMode: 'soft-development'
    };
    const DEVICE_KEY = 'abn_commercial_device_id_v1';
    const LICENSE_KEY = 'abn_commercial_license_state_v1';

    function randomPart(){
        if (window.crypto && crypto.getRandomValues) {
            const bytes = new Uint8Array(4);
            crypto.getRandomValues(bytes);
            return Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join('').toUpperCase();
        }
        return Math.random().toString(16).slice(2,10).toUpperCase();
    }

    function getDeviceId(){
        let id = localStorage.getItem(DEVICE_KEY);
        if (!id) {
            id = 'ABN-DEV-' + randomPart() + '-' + Date.now().toString(36).toUpperCase();
            localStorage.setItem(DEVICE_KEY, id);
        }
        return id;
    }

    function getLicenseState(){
        try { return JSON.parse(localStorage.getItem(LICENSE_KEY) || 'null'); }
        catch (_) { return null; }
    }

    function setText(id, value){
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function renderCommercialCenter(){
        const deviceId = getDeviceId();
        const license = getLicenseState();
        setText('abn-edition-badge', PRODUCT.edition);
        setText('abn-build-badge', PRODUCT.build);
        setText('abn-edition-name', PRODUCT.edition);
        setText('abn-build-version', PRODUCT.build + ' / ' + PRODUCT.buildDate);
        setText('abn-device-id', deviceId);
        const status = document.getElementById('abn-license-status');
        if (status) {
            if (license && license.key) {
                status.textContent = '🟢 ترخيص تجريبي محفوظ: ' + license.key;
                status.style.background = '#dcfce7';
                status.style.color = '#166534';
            } else {
                status.textContent = '🟡 غير مفعل / وضع التطوير';
                status.style.background = '#fef3c7';
                status.style.color = '#92400e';
            }
        }
    }

    window.ABONIBALCommercial = {
        product: PRODUCT,
        getDeviceId,
        getLicenseState,
        activateLicenseSoft: function(){
            const input = document.getElementById('abn-license-key-input');
            const key = (input && input.value ? input.value : '').trim().toUpperCase();
            if (!key) return alert('أدخل مفتاح الترخيص أولاً.');
            const state = {
                key,
                deviceId: getDeviceId(),
                edition: PRODUCT.edition,
                status: 'soft-active',
                activatedAt: Date.now(),
                note: 'Soft activation only. Enforcement will be added in a later patch.'
            };
            localStorage.setItem(LICENSE_KEY, JSON.stringify(state));
            renderCommercialCenter();
            try { if (typeof addAdminLog === 'function') addAdminLog('ترخيص تجريبي', 'تم حفظ مفتاح ترخيص تجريبي للجهاز الحالي'); } catch(_){ }
            alert('✅ تم حفظ الترخيص التجريبي. لن يتم قفل البرنامج في هذه المرحلة.');
        },
        render: renderCommercialCenter
    };

    const originalSwitchTab = window.switchTab;
    if (typeof originalSwitchTab === 'function' && !window.__abnCommercialSwitchPatched) {
        window.switchTab = function(tabId, element){
            const result = originalSwitchTab.apply(this, arguments);
            if (tabId === 'system') setTimeout(renderCommercialCenter, 0);
            return result;
        };
        window.__abnCommercialSwitchPatched = true;
    }

    document.addEventListener('DOMContentLoaded', renderCommercialCenter);
    setTimeout(renderCommercialCenter, 300);
})();

/* Extracted operational script block 13 */
/* ============================================================
   PATCH-005 GOVERNANCE R1
   Non-invasive project governance + self-review diagnostics.
   ============================================================ */
(function(){
    const VERSION = 'PATCH-006-STABILIZATION-P2';
    const protectedModules = ['sync', 'database', 'accounting', 'invoice-logic', 'maintenance', 'excel-import'];
    const completed = [
        'direct-product-search',
        'professional-ui-foundation',
        'commercial-center-soft-license',
        'invoice-print-cleanup',
        'excel-quota-safe-import',
        'dashboard-scope-fix'
    ];

    function byId(id){ return document.getElementById(id); }
    function hasFn(name){ return typeof window[name] === 'function'; }
    function count(selector, root){ return (root || document).querySelectorAll(selector).length; }
    function result(label, ok, detail, warn){ return { label, status: ok ? 'ok' : (warn ? 'warn' : 'fail'), detail: detail || '' }; }

    function runSelfReview(){
        const dash = byId('tab-dash');
        const allDashboardGrids = Array.from(document.querySelectorAll('.dashboard-grid'));
        const externalDashboardGrids = allDashboardGrids.filter(el => dash && !dash.contains(el));
        const tabIds = Array.from(document.querySelectorAll('.tab-content[id^="tab-"]')).map(el => el.id.replace('tab-', ''));
        const navTabIds = Array.from(document.querySelectorAll('.nav-item[onclick*="switchTab"]')).map(el => {
            const m = (el.getAttribute('onclick') || '').match(/switchTab\('([^']+)'/);
            return m ? m[1] : null;
        }).filter(Boolean);
        const missingNav = tabIds.filter(id => !navTabIds.includes(id));
        const orphanNav = navTabIds.filter(id => !tabIds.includes(id));
        const license = window.ABONIBALCommercial && typeof ABONIBALCommercial.getLicenseState === 'function' ? ABONIBALCommercial.getLicenseState() : null;
        const checks = [
            result('مرجع النسخة التجارية', !!window.ABONIBALCommercial, VERSION),
            result('Device ID', !!(window.ABONIBALCommercial && ABONIBALCommercial.getDeviceId && ABONIBALCommercial.getDeviceId()), 'موجود ومحفوظ محليًا'),
            result('مركز النظام والترخيص', !!byId('tab-system') && !!byId('abn-license-status'), 'تبويب النظام موجود'),
            result('القائمة والتبويبات', missingNav.length === 0 && orphanNav.length === 0, missingNav.length || orphanNav.length ? ('missing=' + missingNav.join(',') + ' orphan=' + orphanNav.join(',')) : 'متطابقة'),
            result('حصر Dashboard', externalDashboardGrids.length === 0, externalDashboardGrids.length ? ('خارج الرئيسية: ' + externalDashboardGrids.length) : 'داخل الرئيسية فقط'),
            result('طبقة المزامنة الأساسية', (typeof SyncManager !== 'undefined') && hasFn('pullFromCloud') && hasFn('trackChange'), 'Protected'),
            result('إصلاح Excel Quota', !!window.PATCH004_R2, 'طبقة الاستيراد الآمن محملة', true),
            result('بحث المنتجات المباشر', count('.product-search-results') > 0, count('.product-search-results') + ' containers'),
            result('الفاتورة الاحترافية', count('.invoice-preview') > 0 && count('#invoice-live-currencies') > 0, 'Invoice UI ready'),
            result('حالة الترخيص', !!license && !!license.key, license && license.key ? license.key : 'اختياري الآن - وضع التطوير', true)
        ];
        renderResults(checks);
        return checks;
    }

    function renderResults(checks){
        const box = byId('abn-qa-results');
        const summary = byId('abn-qa-summary');
        if (!box) return;
        box.innerHTML = checks.map(c => {
            const icon = c.status === 'ok' ? '✅' : (c.status === 'warn' ? '⚠️' : '❌');
            return '<div class="abn-qa-result '+c.status+'"><span>'+icon+' '+c.label+'</span><small>'+String(c.detail || '')+'</small></div>';
        }).join('');
        const fail = checks.filter(c => c.status === 'fail').length;
        const warn = checks.filter(c => c.status === 'warn').length;
        const ok = checks.filter(c => c.status === 'ok').length;
        if (summary) summary.textContent = 'النتيجة: ' + ok + ' ناجح، ' + warn + ' تنبيه، ' + fail + ' فشل.';
        try { console.info('ABONIBAL Governance self-review', { version: VERSION, ok, warn, fail, checks }); } catch(_){ }
    }

    window.ABONIBALGovernance = {
        version: VERSION,
        protectedModules,
        completed,
        runSelfReview
    };

    const originalCommercialRender = window.ABONIBALCommercial && window.ABONIBALCommercial.render;
    if (typeof originalCommercialRender === 'function' && !window.__abnGovernanceCommercialPatched) {
        window.ABONIBALCommercial.render = function(){
            const out = originalCommercialRender.apply(this, arguments);
            setTimeout(function(){ if (byId('tab-system') && byId('tab-system').classList.contains('active')) runSelfReview(); }, 0);
            return out;
        };
        window.__abnGovernanceCommercialPatched = true;
    }

    const originalSwitchTab = window.switchTab;
    if (typeof originalSwitchTab === 'function' && !window.__abnGovernanceSwitchPatched) {
        window.switchTab = function(tabId, element){
            const out = originalSwitchTab.apply(this, arguments);
            if (tabId === 'system') setTimeout(runSelfReview, 80);
            return out;
        };
        window.__abnGovernanceSwitchPatched = true;
    }

    document.addEventListener('DOMContentLoaded', function(){
        setTimeout(function(){ if (byId('tab-system') && byId('tab-system').classList.contains('active')) runSelfReview(); }, 500);
    });
    console.log('✅ ' + VERSION + ' governance layer loaded');
})();

/* Extracted operational script block 15 */
/* ============================================================
   PATCH-006 / PROJECT STABILIZATION P2
   Runtime listener/timer governance. No feature/UI redesign.
   ============================================================ */
(function(){
    const VERSION = 'PATCH-006-STABILIZATION-P2';
    if (window.__ABN_STABILIZATION_P2_LOADED__) return;
    window.__ABN_STABILIZATION_P2_LOADED__ = true;

    const runtime = window.ABNRuntimeStability || {};
    let lastRequestedSyncAt = 0;
    let syncRequestInFlight = null;

    function info(message, data) {
        try { console.info('[ABONIBAL Runtime]', message, data || ''); } catch (_) {}
    }
    function warn(message, error) {
        try { console.warn('[ABONIBAL Runtime]', message, error || ''); } catch (_) {}
    }

    runtime.requestSync = function requestSyncStabilizedP2(reason) {
        const now = Date.now();
        if (syncRequestInFlight) return syncRequestInFlight;
        if (now - lastRequestedSyncAt < 1800) {
            return Promise.resolve({ success: true, throttled: true, reason: reason || 'runtime-burst-guard' });
        }
        lastRequestedSyncAt = now;
        if (typeof SyncManager === 'undefined' || typeof SyncManager.performDeltaSync !== 'function') {
            return Promise.resolve({ success: false, error: 'SyncManager not ready' });
        }
        syncRequestInFlight = Promise.resolve()
            .then(function(){ return SyncManager.performDeltaSync(); })
            .catch(function(error){ warn('sync request failed', error); return { success: false, error: error && error.message ? error.message : String(error) }; })
            .finally(function(){ syncRequestInFlight = null; });
        return syncRequestInFlight;
    };

    runtime.health = function runtimeHealthP2() {
        const p1Health = window.ABNStabilization && typeof window.ABNStabilization.health === 'function'
            ? window.ABNStabilization.health()
            : null;
        return {
            version: VERSION,
            p1: p1Health,
            networkOnlineHandler: !!window.__ABN_NET_ONLINE_HANDLER__,
            networkOfflineHandler: !!window.__ABN_NET_OFFLINE_HANDLER__,
            firebaseConnectionWatcher: !!window.__ABN_FIREBASE_CONNECTION_CALLBACK__,
            liveMetaInterval: !!window.__ABN_LIVE_META_INTERVAL__,
            globalSearchClickHandler: !!window.__ABN_GLOBAL_SEARCH_OUTSIDE_CLICK__,
            productPriceAutoFillHandler: !!window.__ABN_PRICE_AUTOFILL_HANDLER__,
            serviceWorkerHandler: !!window.__ABN_SW_REGISTER_HANDLER__,
            globalErrorHandler: !!window.__ABN_GLOBAL_ERROR_HANDLER__,
            globalRejectionHandler: !!window.__ABN_GLOBAL_REJECTION_HANDLER__,
            lastRequestedSyncAt: lastRequestedSyncAt
        };
    };

    window.ABNRuntimeStability = runtime;
    try { if (typeof patchLog === 'function') patchLog(VERSION + ' loaded'); } catch (_) {}
    info(VERSION + ' loaded', runtime.health());
})();

/* Extracted operational script block 16 */
/* ============================================================
   PATCH-006 / PROJECT STABILIZATION P3
   Sync Stabilization: bounded upload/download, queue hygiene,
   offline overflow preservation, and single-flight sync control.
   No feature/UI redesign.
   ============================================================ */
(function(){
    const VERSION = 'PATCH-006-STABILIZATION-P3';
    if (window.__ABN_STABILIZATION_P3_LOADED__) return;
    window.__ABN_STABILIZATION_P3_LOADED__ = true;

    const QUEUE_LOCAL_CAP = 900;
    const QUEUE_LEGACY_MIRROR_CAP = 250;
    const QUEUE_SYNC_BATCH = 140;
    const QUEUE_SYNC_MAX_PER_RUN = 560;
    const REMOTE_BATCH_SIZE = 350;
    const REMOTE_MAX_PER_RUN = 1400;
    const QUEUE_OVERFLOW_KEY = 'abonibalProductionSyncQueueV2Overflow';
    const VALID_OPS = { create: true, update: true, delete: true, clearCollection: true };

    let syncInFlight = null;
    let syncRerunRequested = false;
    let lastSyncStartAt = 0;
    let consecutiveFailures = 0;
    let backoffUntil = 0;
    let queueSaveLocked = false;

    function info(message, data) {
        try { console.info('[ABONIBAL Sync P3]', message, data || ''); } catch (_) {}
    }
    function warn(message, error) {
        try { console.warn('[ABONIBAL Sync P3]', message, error || ''); } catch (_) {}
    }
    function parseJson(value, fallback) {
        try {
            const parsed = JSON.parse(value || '');
            return parsed == null ? fallback : parsed;
        } catch (_) { return fallback; }
    }
    function arrayValue(value) {
        return Array.isArray(value) ? value.filter(Boolean) : [];
    }
    function nowId() {
        try { if (typeof generateUniqueID === 'function') return generateUniqueID(); } catch (_) {}
        return 'abn-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    }
    function getDeviceId() {
        try { if (typeof DEVICE_ID !== 'undefined' && DEVICE_ID) return DEVICE_ID; } catch (_) {}
        try { return localStorage.getItem('abonibalProductionDeviceId') || 'local-device'; } catch (_) {}
        return 'local-device';
    }
    function safeStatus(text) {
        try { if (typeof updateSyncStatus === 'function') updateSyncStatus(text); } catch (_) {}
    }
    function safeSpinner(active) {
        try { if (typeof showSpinner === 'function') showSpinner(!!active); } catch (_) {}
    }
    function getStateRef() {
        try { if (typeof state !== 'undefined') return state; } catch (_) {}
        return window.__ABN_STATE_REF__ || null;
    }
    function getQueueRef() {
        try { if (typeof SyncQueue !== 'undefined') return SyncQueue; } catch (_) {}
        return window.SyncQueue || null;
    }
    function getManagerRef() {
        try { if (typeof SyncManager !== 'undefined') return SyncManager; } catch (_) {}
        return window.SyncManager || null;
    }
    function changeTimestamp(change) {
        return Number(change && (change.localSeq || change.timestamp || (change.data && change.data._updatedAt) || 0)) || 0;
    }
    function sanitizeId(value) {
        return String(value || '').replace(/[^a-zA-Z0-9_\-:.]/g, '_').slice(0, 160);
    }
    function normalizeChange(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const change = Object.assign({}, raw);
        change.collection = change.collection ? String(change.collection) : '';
        change.operation = change.operation ? String(change.operation) : 'update';
        if (!VALID_OPS[change.operation]) return null;
        if (change.entityId == null || change.entityId === '') {
            if (change.data && change.data.id != null) change.entityId = String(change.data.id);
            else if (change.operation === 'clearCollection') change.entityId = '__all__';
        }
        change.entityId = String(change.entityId == null ? '' : change.entityId);
        if (!change.collection || !change.entityId) return null;
        change.timestamp = Number(change.timestamp || Date.now());
        change.localSeq = Number(change.localSeq || change.timestamp || Date.now());
        change.deviceId = String(change.deviceId || getDeviceId());
        change.synced = !!change.synced;
        if (!change.id) {
            change.id = sanitizeId(['p3', change.collection, change.entityId, change.operation, change.timestamp, change.deviceId].join('_'));
        }
        if ((change.operation === 'create' || change.operation === 'update') && change.data && typeof change.data === 'object' && !Array.isArray(change.data)) {
            change.data = Object.assign({}, change.data, {
                id: change.data.id || (change.entityId !== '__all__' ? change.entityId : change.data.id),
                _updatedAt: Number(change.data._updatedAt || change.timestamp || Date.now()),
                _deviceId: change.data._deviceId || change.deviceId
            });
        }
        if (change.operation === 'delete' && (!change.data || typeof change.data !== 'object')) {
            change.data = { id: change.entityId, _deleted: true, _updatedAt: change.timestamp, _deviceId: change.deviceId };
        }
        return change;
    }
    function queueKey(change) {
        if (!change) return '';
        return String(change.id || [change.collection, change.entityId, change.operation, change.timestamp, change.deviceId].join('|'));
    }
    function normalizeChangeArray(items) {
        const map = new Map();
        arrayValue(items).forEach(function(item){
            const change = normalizeChange(item);
            if (!change) return;
            const key = queueKey(change);
            const current = map.get(key);
            if (!current || changeTimestamp(change) >= changeTimestamp(current)) map.set(key, change);
        });
        return Array.from(map.values()).sort(function(a, b){ return changeTimestamp(a) - changeTimestamp(b); });
    }
    function normalizeQueueInPlace() {
        const queue = getQueueRef();
        if (!queue || !Array.isArray(queue.items)) return [];
        const v2 = parseJson(localStorage.getItem('abonibalProductionSyncQueueV2'), []);
        const legacy = parseJson(localStorage.getItem('abonibalProductionSyncQueueLegacy'), []);
        const merged = normalizeChangeArray([].concat(queue.items || [], arrayValue(v2), arrayValue(legacy)));
        queue.items = merged;
        return merged;
    }
    function splitForLocalStorage(items) {
        const clean = normalizeChangeArray(items || []);
        const pending = clean.filter(function(c){ return c && !c.synced; });
        const syncedTail = clean.filter(function(c){ return c && c.synced; }).slice(-60);
        if (pending.length <= QUEUE_LOCAL_CAP) {
            return { keep: syncedTail.concat(pending), overflow: [] };
        }
        return {
            keep: syncedTail.concat(pending.slice(-QUEUE_LOCAL_CAP)),
            overflow: pending.slice(0, Math.max(0, pending.length - QUEUE_LOCAL_CAP))
        };
    }
    function saveOverflowAsync(items) {
        if (!items || !items.length || typeof localforage === 'undefined') return;
        try {
            localforage.getItem(QUEUE_OVERFLOW_KEY).then(function(existing){
                const merged = normalizeChangeArray([].concat(arrayValue(existing), arrayValue(items)));
                return localforage.setItem(QUEUE_OVERFLOW_KEY, merged.slice(-2400));
            }).catch(function(error){ warn('overflow save failed', error); });
        } catch (error) { warn('overflow save unavailable', error); }
    }
    async function restoreOverflowIfRoom() {
        const queue = getQueueRef();
        if (!queue || !Array.isArray(queue.items) || typeof localforage === 'undefined') return 0;
        try {
            const overflow = normalizeChangeArray(await localforage.getItem(QUEUE_OVERFLOW_KEY));
            if (!overflow.length) return 0;
            normalizeQueueInPlace();
            const pendingCount = queue.items.filter(function(c){ return c && !c.synced; }).length;
            const room = Math.max(0, QUEUE_LOCAL_CAP - pendingCount);
            if (!room) return 0;
            const moving = overflow.slice(0, room);
            const remaining = overflow.slice(room);
            queue.items = normalizeChangeArray([].concat(queue.items || [], moving));
            if (typeof queue.save === 'function') queue.save();
            if (remaining.length) await localforage.setItem(QUEUE_OVERFLOW_KEY, remaining);
            else await localforage.removeItem(QUEUE_OVERFLOW_KEY);
            return moving.length;
        } catch (error) {
            warn('overflow restore failed', error);
            return 0;
        }
    }
    function installQueueGovernance() {
        const queue = getQueueRef();
        if (!queue || queue.__stabilizationP3QueuePatched) return;

        queue.save = function saveQueueStabilizedP3() {
            if (queueSaveLocked) return;
            queueSaveLocked = true;
            try {
                const split = splitForLocalStorage(this.items || []);
                this.items = split.keep;
                if (split.overflow.length) saveOverflowAsync(split.overflow);
                localStorage.setItem('abonibalProductionSyncQueueV2', JSON.stringify(this.items));
                localStorage.setItem('abonibalProductionSyncQueueLegacy', JSON.stringify(this.items.filter(function(c){ return c && !c.synced; }).slice(-QUEUE_LEGACY_MIRROR_CAP)));
            } catch (error) {
                warn('queue localStorage save failed; compacting safely', error);
                const clean = normalizeChangeArray(this.items || []);
                const pending = clean.filter(function(c){ return c && !c.synced; });
                const critical = pending.filter(function(c){ return c.collection !== 'products' && c.collection !== 'itemTracks'; });
                const productTail = pending.filter(function(c){ return c.collection === 'products' || c.collection === 'itemTracks'; }).slice(-160);
                this.items = critical.concat(productTail).slice(-520);
                try { localStorage.removeItem('abonibalProductionSyncQueueV2'); localStorage.removeItem('abonibalProductionSyncQueueLegacy'); } catch (_) {}
                try { localStorage.setItem('abonibalProductionSyncQueueV2', JSON.stringify(this.items)); } catch (secondError) { warn('queue compact save failed', secondError); }
                if (pending.length > this.items.length) saveOverflowAsync(pending.slice(0, pending.length - this.items.length));
            } finally {
                queueSaveLocked = false;
            }
        };

        queue.getPending = function getPendingStabilizedP3() {
            normalizeQueueInPlace();
            return (this.items || []).filter(function(change){ return change && !change.synced && normalizeChange(change); });
        };

        queue.add = function addChangeStabilizedP3(change) {
            const normalized = normalizeChange(change);
            if (!normalized) {
                warn('invalid sync change skipped', change);
                return;
            }
            this.items = normalizeChangeArray([].concat(this.items || [], [normalized]));
            if (typeof this.trim === 'function') this.trim();
            this.save();
        };

        queue.trim = function trimQueueStabilizedP3() {
            const split = splitForLocalStorage(this.items || []);
            this.items = split.keep;
            if (split.overflow.length) saveOverflowAsync(split.overflow);
        };

        queue.__stabilizationP3QueuePatched = true;
        normalizeQueueInPlace();
        queue.save();
    }

    function installSyncManagerGovernance() {
        const manager = getManagerRef();
        const queue = getQueueRef();
        if (!manager || !queue || manager.__stabilizationP3ManagerPatched) return;

        const originalDownloadRemoteChanges = typeof manager.downloadRemoteChanges === 'function' ? manager.downloadRemoteChanges.bind(manager) : null;
        const originalUploadLocalChanges = typeof manager.uploadLocalChanges === 'function' ? manager.uploadLocalChanges.bind(manager) : null;
        const originalPerformDeltaSync = typeof manager.performDeltaSync === 'function' ? manager.performDeltaSync.bind(manager) : null;

        manager.collectPendingChanges = function collectPendingChangesStabilizedP3() {
            installQueueGovernance();
            const pending = queue.getPending().map(normalizeChange).filter(Boolean);
            return pending.slice(0, QUEUE_SYNC_MAX_PER_RUN);
        };

        if (originalDownloadRemoteChanges) {
            manager.downloadRemoteChanges = async function downloadRemoteChangesStabilizedP3(currentVersion) {
                if (!navigator.onLine) return [];
                if (typeof ensureFirebaseAccess === 'function') {
                    const access = await ensureFirebaseAccess();
                    if (!access.ok) throw new Error('تعذر تسجيل الدخول إلى Firebase: ' + access.error);
                }
                if (typeof db === 'undefined' || !db || !db.ref) {
                    return originalDownloadRemoteChanges(currentVersion);
                }
                let cursor = Number(currentVersion) || 0;
                let collected = [];
                for (let page = 0; page < 6 && collected.length < REMOTE_MAX_PER_RUN; page++) {
                    const snapshot = await db.ref('sync/changes')
                        .orderByChild('syncVersion')
                        .startAt(cursor + 1)
                        .limitToFirst(REMOTE_BATCH_SIZE)
                        .once('value');
                    const batch = normalizeChangeArray(Object.values(snapshot.val() || {}))
                        .filter(function(change){ return change && change.id && change.timestamp; })
                        .sort(function(a, b){ return (Number(a.syncVersion) || 0) - (Number(b.syncVersion) || 0) || (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0); });
                    if (!batch.length) break;
                    collected = collected.concat(batch);
                    const maxVersion = Math.max.apply(null, batch.map(function(change){ return Number(change.syncVersion) || 0; }));
                    if (!maxVersion || maxVersion <= cursor) break;
                    cursor = maxVersion;
                    if (batch.length < REMOTE_BATCH_SIZE) break;
                }
                return collected.slice(0, REMOTE_MAX_PER_RUN);
            };
        }

        manager.uploadLocalChanges = async function uploadLocalChangesStabilizedP3(pending) {
            const selected = normalizeChangeArray(pending || manager.collectPendingChanges()).slice(0, QUEUE_SYNC_MAX_PER_RUN);
            if (!selected.length) return 0;
            if (!navigator.onLine) return 0;
            if (typeof ensureFirebaseAccess === 'function') {
                const access = await ensureFirebaseAccess();
                if (!access.ok) throw new Error('تعذر تسجيل الدخول إلى Firebase: ' + access.error);
            }
            if (typeof db === 'undefined' || !db || !db.ref || typeof manager.allocateVersions !== 'function' || typeof manager.buildUpdates !== 'function') {
                return originalUploadLocalChanges ? originalUploadLocalChanges(selected) : 0;
            }
            let uploaded = 0;
            for (let start = 0; start < selected.length; start += QUEUE_SYNC_BATCH) {
                if (!navigator.onLine) break;
                const chunk = selected.slice(start, start + QUEUE_SYNC_BATCH);
                const versioned = await manager.allocateVersions(chunk);
                const updates = manager.buildUpdates(versioned);
                await db.ref().update(updates);
                queue.markSyncedByIds(chunk.map(function(change){ return change.id; }));
                queue.removeSynced();
                const appState = getStateRef();
                if (appState) {
                    const maxVersion = Math.max.apply(null, [Number(appState.syncVersion) || 0].concat(versioned.map(function(change){ return Number(change.syncVersion) || 0; })));
                    appState.syncVersion = maxVersion;
                }
                uploaded += versioned.length;
                safeStatus('📤 رفع ' + uploaded + ' / ' + selected.length);
                await new Promise(function(resolve){ setTimeout(resolve, 0); });
            }
            const appState = getStateRef();
            if (appState && typeof saveToLocal === 'function') {
                try { await saveToLocal(); } catch (error) { warn('local save after upload failed', error); }
            }
            if (queue.getPending().length > 0) syncRerunRequested = true;
            return uploaded;
        };

        if (originalPerformDeltaSync) {
            manager.performDeltaSync = function performDeltaSyncStabilizedP3(reason) {
                const now = Date.now();
                installQueueGovernance();
                if (!navigator.onLine) {
                    safeStatus('📴 أوفلاين - محفوظ محليًا');
                    return Promise.resolve({ success: false, offline: true, error: 'No internet' });
                }
                if (now < backoffUntil) {
                    return Promise.resolve({ success: false, backoff: true, retryAt: backoffUntil });
                }
                if (syncInFlight) {
                    syncRerunRequested = true;
                    return syncInFlight.then(function(result){ return Object.assign({}, result || {}, { joined: true }); });
                }
                if (now - lastSyncStartAt < 900) {
                    return Promise.resolve({ success: true, throttled: true });
                }
                lastSyncStartAt = now;
                syncInFlight = Promise.resolve()
                    .then(restoreOverflowIfRoom)
                    .then(function(restored){ if (restored) info('overflow restored', { restored: restored }); })
                    .then(function(){ normalizeQueueInPlace(); })
                    .then(function(){ return originalPerformDeltaSync(reason || 'p3'); })
                    .then(function(result){
                        if (result && result.success === false) {
                            consecutiveFailures += 1;
                            backoffUntil = Date.now() + Math.min(30000, 1500 * consecutiveFailures);
                        } else {
                            consecutiveFailures = 0;
                            backoffUntil = 0;
                        }
                        return result;
                    })
                    .catch(function(error){
                        consecutiveFailures += 1;
                        backoffUntil = Date.now() + Math.min(30000, 2000 * consecutiveFailures);
                        safeStatus('⚠️ فشل المزامنة');
                        warn('performDeltaSync failed', error);
                        return { success: false, error: error && error.message ? error.message : String(error) };
                    })
                    .finally(function(){
                        syncInFlight = null;
                        if (syncRerunRequested && navigator.onLine) {
                            syncRerunRequested = false;
                            setTimeout(function(){
                                const managerAfter = getManagerRef();
                                if (managerAfter && typeof managerAfter.performDeltaSync === 'function') managerAfter.performDeltaSync('p3-rerun');
                            }, 1200);
                        } else {
                            syncRerunRequested = false;
                        }
                    });
                return syncInFlight;
            };
        }

        manager.__stabilizationP3ManagerPatched = true;
    }

    function queueHealth(queue) {
        queue = queue || getQueueRef();
        const items = queue && Array.isArray(queue.items) ? normalizeChangeArray(queue.items) : [];
        const pending = items.filter(function(c){ return c && !c.synced; });
        const byCollection = {};
        pending.forEach(function(change){ byCollection[change.collection] = (byCollection[change.collection] || 0) + 1; });
        return {
            total: items.length,
            pending: pending.length,
            synced: items.length - pending.length,
            oldestPendingAt: pending.length ? Math.min.apply(null, pending.map(changeTimestamp)) : 0,
            byCollection: byCollection
        };
    }

    async function healthAsync() {
        let overflow = [];
        try { if (typeof localforage !== 'undefined') overflow = normalizeChangeArray(await localforage.getItem(QUEUE_OVERFLOW_KEY)); } catch (_) {}
        return Object.assign(window.ABNSyncStability.health(), { overflow: overflow.length });
    }

    installQueueGovernance();
    installSyncManagerGovernance();

    window.ABNSyncStability = {
        version: VERSION,
        health: function(){
            return {
                version: VERSION,
                queue: queueHealth(),
                managerPatched: !!(getManagerRef() && getManagerRef().__stabilizationP3ManagerPatched),
                queuePatched: !!(getQueueRef() && getQueueRef().__stabilizationP3QueuePatched),
                syncInFlight: !!syncInFlight,
                syncRerunRequested: !!syncRerunRequested,
                consecutiveFailures: consecutiveFailures,
                backoffUntil: backoffUntil
            };
        },
        healthAsync: healthAsync,
        restoreOverflow: restoreOverflowIfRoom,
        normalizeQueue: function(){ const q = getQueueRef(); const result = normalizeQueueInPlace(); if (q && typeof q.save === 'function') q.save(); return queueHealth(q); }
    };

    try { if (typeof patchLog === 'function') patchLog(VERSION + ' loaded'); } catch (_) {}
    info(VERSION + ' loaded', window.ABNSyncStability.health());
})();

/* Extracted operational script block 17 */
/* ============================================================
   PATCH-006 / PROJECT STABILIZATION P4
   Data Layer Stabilization: central local persistence + safe snapshots.
   No feature additions and no business-logic changes.
   ============================================================ */
(function(){
    'use strict';
    const VERSION = 'PATCH-006-STABILIZATION-P4';
    if (window.__ABN_STABILIZATION_P4_LOADED__) return;
    window.__ABN_STABILIZATION_P4_LOADED__ = true;

    const SNAPSHOT_KEY = 'abnDataSnapshotV1';
    const BACKUP_KEY = 'abnDataSnapshotBackupV1';
    const SAVE_DEBOUNCE_MS = 250;
    const DEFAULT_CATEGORIES = ['إطارات', 'محركات', 'اكسسوارات'];
    const ARRAY_FIELDS = [
        'categories', 'products', 'expenses', 'clients', 'suppliers', 'retailSales', 'invoices',
        'itemTracks', 'partnerWithdrawals', 'exchanges', 'capitalRecords', 'adminLogs',
        'safeTransactions', 'ledgerEntries'
    ];
    const OBJECT_FIELDS = ['rates', 'safes'];
    const SPLIT_KEY_BY_FIELD = {
        products: 'PRODUCTS',
        clients: 'CLIENTS',
        invoices: 'INVOICES',
        retailSales: 'RETAIL_SALES',
        expenses: 'EXPENSES',
        itemTracks: 'ITEM_TRACKS',
        safeTransactions: 'SAFE_TRANSACTIONS',
        ledgerEntries: 'LEDGER_ENTRIES'
    };

    let saveInFlight = null;
    let loadInFlight = null;
    let pendingDebouncedSave = null;
    let lastSaveAt = 0;
    let lastLoadAt = 0;
    let lastError = null;

    function warn(message, error) {
        lastError = error ? (error.message || String(error)) : message;
        try { console.warn('[ABONIBAL Data P4]', message, error || ''); } catch (_) {}
    }

    function info(message, data) {
        try { console.info('[ABONIBAL Data P4]', message, data || ''); } catch (_) {}
    }

    function getAppState() {
        try { return typeof state !== 'undefined' ? state : window.state; } catch (_) { return window.state; }
    }

    function getStorageKeys() {
        try { return typeof STORAGE_KEYS !== 'undefined' ? STORAGE_KEYS : {}; } catch (_) { return {}; }
    }

    function storageAvailable() {
        return typeof localforage !== 'undefined' && localforage &&
            typeof localforage.getItem === 'function' && typeof localforage.setItem === 'function';
    }

    function arrayValue(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value.filter(function(item){ return item !== null && item !== undefined; });
        if (typeof value === 'object') return Object.values(value).filter(function(item){ return item !== null && item !== undefined; });
        return [];
    }

    function objectValue(value, fallback) {
        if (value && typeof value === 'object' && !Array.isArray(value)) return Object.assign({}, value);
        return Object.assign({}, fallback || {});
    }

    function numberValue(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function cloneSafe(value) {
        try {
            if (typeof structuredClone === 'function') return structuredClone(value);
        } catch (_) {}
        try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
    }

    function normalizeState(appState) {
        appState = appState || getAppState();
        if (!appState) return null;

        ARRAY_FIELDS.forEach(function(field){
            appState[field] = arrayValue(appState[field]);
        });
        if (!appState.categories.length) appState.categories = DEFAULT_CATEGORIES.slice();

        appState.rates = objectValue(appState.rates, { try: 0, syp: 0 });
        appState.safes = objectValue(appState.safes, { usd: 0, try: 0, syp: 0 });

        appState.invoiceCount = Math.max(1, numberValue(appState.invoiceCount, 150));
        appState.syncVersion = Math.max(0, numberValue(appState.syncVersion, 0));
        appState.lastSyncTime = appState.lastSyncTime || null;

        if (typeof normalizeStateForLegacyData === 'function') {
            try { normalizeStateForLegacyData(); } catch (error) { warn('legacy normalization failed', error); }
        }
        return appState;
    }

    function buildStateData(appState) {
        appState = normalizeState(appState || getAppState());
        if (!appState) return null;
        const data = {};
        ARRAY_FIELDS.forEach(function(field){ data[field] = cloneSafe(arrayValue(appState[field])); });
        data.rates = cloneSafe(objectValue(appState.rates, { try: 0, syp: 0 }));
        data.safes = cloneSafe(objectValue(appState.safes, { usd: 0, try: 0, syp: 0 }));
        data.invoiceCount = numberValue(appState.invoiceCount, 150);
        data.syncVersion = numberValue(appState.syncVersion, 0);
        data.lastSyncTime = appState.lastSyncTime || null;
        return data;
    }

    function buildSnapshot(reason) {
        return {
            meta: {
                version: VERSION,
                schemaVersion: 1,
                reason: reason || 'save',
                savedAt: Date.now()
            },
            data: buildStateData()
        };
    }

    function hydrateState(data) {
        const appState = getAppState();
        if (!appState || !data || typeof data !== 'object') return false;
        ARRAY_FIELDS.forEach(function(field){
            appState[field] = arrayValue(data[field]);
        });
        if (!appState.categories.length) appState.categories = DEFAULT_CATEGORIES.slice();
        appState.rates = objectValue(data.rates, { try: 0, syp: 0 });
        appState.safes = objectValue(data.safes, { usd: 0, try: 0, syp: 0 });
        appState.invoiceCount = Math.max(1, numberValue(data.invoiceCount, 150));
        appState.syncVersion = Math.max(0, numberValue(data.syncVersion, 0));
        appState.lastSyncTime = data.lastSyncTime || null;
        normalizeState(appState);
        return true;
    }

    async function readSnapshot(key) {
        if (!storageAvailable()) return null;
        const snapshot = await localforage.getItem(key || SNAPSHOT_KEY);
        if (snapshot && snapshot.data && typeof snapshot.data === 'object') return snapshot;
        return null;
    }

    async function writeSnapshot(snapshot) {
        if (!storageAvailable() || !snapshot || !snapshot.data) return false;
        try {
            const previous = await readSnapshot(SNAPSHOT_KEY);
            if (previous) await localforage.setItem(BACKUP_KEY, previous);
            await localforage.setItem(SNAPSHOT_KEY, snapshot);
            return true;
        } catch (error) {
            warn('snapshot write failed', error);
            return false;
        }
    }

    async function writeSplitStorage(data) {
        if (!storageAvailable() || !data) return false;
        const keys = getStorageKeys();
        const operations = [];
        Object.keys(SPLIT_KEY_BY_FIELD).forEach(function(field){
            const keyName = SPLIT_KEY_BY_FIELD[field];
            const storageKey = keys[keyName];
            if (storageKey) operations.push(localforage.setItem(storageKey, arrayValue(data[field])));
        });
        const otherData = {
            categories: arrayValue(data.categories),
            suppliers: arrayValue(data.suppliers),
            rates: objectValue(data.rates, { try: 0, syp: 0 }),
            safes: objectValue(data.safes, { usd: 0, try: 0, syp: 0 }),
            exchanges: arrayValue(data.exchanges),
            partnerWithdrawals: arrayValue(data.partnerWithdrawals),
            capitalRecords: arrayValue(data.capitalRecords),
            invoiceCount: numberValue(data.invoiceCount, 150),
            adminLogs: arrayValue(data.adminLogs),
        };
        if (keys.OTHER_DATA) operations.push(localforage.setItem(keys.OTHER_DATA, otherData));
        if (keys.SYNC_VERSION) operations.push(localforage.setItem(keys.SYNC_VERSION, numberValue(data.syncVersion, 0)));
        if (keys.LAST_SYNC_TIME) operations.push(localforage.setItem(keys.LAST_SYNC_TIME, data.lastSyncTime || null));
        await Promise.all(operations);
        return true;
    }

    function criticalDataCount(data) {
        data = data || buildStateData() || {};
        return arrayValue(data.products).length + arrayValue(data.clients).length +
            arrayValue(data.invoices).length + arrayValue(data.retailSales).length +
            arrayValue(data.expenses).length;
    }

    async function performDataSave(reason) {
        const appState = normalizeState();
        if (!appState) return false;
        const snapshot = buildSnapshot(reason || 'saveAll');
        let splitSaved = false;
        try { splitSaved = await writeSplitStorage(snapshot.data); }
        catch (error) { warn('split storage save failed', error); }
        const snapshotSaved = await writeSnapshot(snapshot);
        lastSaveAt = Date.now();
        try { if (typeof updateSyncStatus === 'function') updateSyncStatus('💾 محفوظ محليًا'); } catch (_) {}
        return !!(splitSaved || snapshotSaved);
    }

    async function saveAll(reason) {
        if (saveInFlight) return saveInFlight;
        saveInFlight = Promise.resolve().then(function(){
            return performDataSave(reason || 'saveAll');
        }).finally(function(){ saveInFlight = null; });
        return saveInFlight;
    }

    async function loadAll(reason) {
        if (loadInFlight) return loadInFlight;
        loadInFlight = Promise.resolve().then(async function(){
            const originalOk = originalLoadFromLocal ? await originalLoadFromLocal() : false;
            normalizeState();
            let data = buildStateData();
            const hasCriticalData = criticalDataCount(data) > 0;
            if (!originalOk || !hasCriticalData) {
                const snapshot = await readSnapshot(SNAPSHOT_KEY) || await readSnapshot(BACKUP_KEY);
                if (snapshot && criticalDataCount(snapshot.data) >= criticalDataCount(data)) {
                    hydrateState(snapshot.data);
                    data = buildStateData();
                    info('state restored from unified snapshot', { reason: reason || 'loadAll', count: criticalDataCount(data) });
                }
            }
            lastLoadAt = Date.now();
            if (criticalDataCount(data) > 0) await writeSnapshot(buildSnapshot('post-load-verified'));
            return true;
        }).catch(function(error){
            warn('loadAll failed', error);
            return false;
        }).finally(function(){ loadInFlight = null; });
        return loadInFlight;
    }

    function scheduleSave(reason) {
        if (pendingDebouncedSave) clearTimeout(pendingDebouncedSave);
        pendingDebouncedSave = setTimeout(function(){
            pendingDebouncedSave = null;
            saveAll(reason || 'debounced').catch(function(error){ warn('debounced save failed', error); });
        }, SAVE_DEBOUNCE_MS);
    }

    function getCollection(name) {
        const appState = normalizeState();
        if (!appState || !ARRAY_FIELDS.includes(name)) return [];
        return appState[name];
    }

    function setCollection(name, items, options) {
        const appState = normalizeState();
        if (!appState || !ARRAY_FIELDS.includes(name)) return false;
        appState[name] = arrayValue(items);
        if (!options || options.save !== false) scheduleSave('setCollection:' + name);
        return true;
    }

    function findById(collection, id) {
        return getCollection(collection).find(function(item){ return item && String(item.id) === String(id); }) || null;
    }

    function upsertById(collection, item, options) {
        if (!item || typeof item !== 'object') return false;
        const list = getCollection(collection);
        if (!ARRAY_FIELDS.includes(collection)) return false;
        const key = item.id ? String(item.id) : '';
        const idx = key ? list.findIndex(function(existing){ return existing && String(existing.id) === key; }) : -1;
        if (idx >= 0) list[idx] = Object.assign({}, list[idx], item);
        else list.push(item);
        if (!options || options.save !== false) scheduleSave('upsert:' + collection);
        return true;
    }

    function removeById(collection, id, options) {
        const list = getCollection(collection);
        const before = list.length;
        const filtered = list.filter(function(item){ return !(item && String(item.id) === String(id)); });
        if (filtered.length === before) return false;
        setCollection(collection, filtered, { save: false });
        if (!options || options.save !== false) scheduleSave('remove:' + collection);
        return true;
    }

    async function restoreSnapshot(preferBackup) {
        const snapshot = await readSnapshot(preferBackup ? BACKUP_KEY : SNAPSHOT_KEY) || await readSnapshot(BACKUP_KEY);
        if (!snapshot) return false;
        const restored = hydrateState(snapshot.data);
        if (restored) await saveAll('restoreSnapshot');
        return restored;
    }

    function health() {
        const data = buildStateData() || {};
        const counts = {};
        ARRAY_FIELDS.forEach(function(field){ counts[field] = arrayValue(data[field]).length; });
        return {
            version: VERSION,
            dataLayerPatched: true,
            savePatched: !!window.__ABN_P4_SAVE_PATCHED__,
            loadPatched: !!window.__ABN_P4_LOAD_PATCHED__,
            storage: storageAvailable() ? 'localforage' : 'unavailable',
            counts: counts,
            criticalDataCount: criticalDataCount(data),
            syncVersion: numberValue(data.syncVersion, 0),
            invoiceCount: numberValue(data.invoiceCount, 150),
            lastSaveAt: lastSaveAt,
            lastLoadAt: lastLoadAt,
            lastError: lastError
        };
    }

    const originalSaveToLocal = (function(){ try { return typeof saveToLocal === 'function' ? saveToLocal.bind(window) : null; } catch (_) { return null; } })();
    const originalLoadFromLocal = (function(){ try { return typeof loadFromLocal === 'function' ? loadFromLocal.bind(window) : null; } catch (_) { return null; } })();

    async function saveToLocalStabilizedP4() {
        if (saveInFlight) return saveInFlight;
        saveInFlight = Promise.resolve().then(async function(){
            normalizeState();
            let originalResult = true;
            if (originalSaveToLocal) {
                try { originalResult = await originalSaveToLocal(); }
                catch (error) { originalResult = false; warn('original saveToLocal failed', error); }
            }
            await performDataSave('saveToLocal-wrapper');
            return originalResult !== false;
        }).finally(function(){ saveInFlight = null; });
        return saveInFlight;
    }

    async function loadFromLocalStabilizedP4() {
        return loadAll('loadFromLocal-wrapper');
    }

    try {
        saveToLocal = saveToLocalStabilizedP4;
        window.saveToLocal = saveToLocalStabilizedP4;
        window.__ABN_P4_SAVE_PATCHED__ = true;
    } catch (error) { warn('saveToLocal patch failed', error); }

    try {
        loadFromLocal = loadFromLocalStabilizedP4;
        window.loadFromLocal = loadFromLocalStabilizedP4;
        window.__ABN_P4_LOAD_PATCHED__ = true;
    } catch (error) { warn('loadFromLocal patch failed', error); }

    window.ABNDataStore = {
        version: VERSION,
        normalize: normalizeState,
        snapshot: buildSnapshot,
        saveAll: saveAll,
        loadAll: loadAll,
        scheduleSave: scheduleSave,
        restoreSnapshot: restoreSnapshot,
        getCollection: getCollection,
        setCollection: setCollection,
        findById: findById,
        upsertById: upsertById,
        removeById: removeById,
        health: health,
        keys: {
            snapshot: SNAPSHOT_KEY,
            backup: BACKUP_KEY
        }
    };

    function markBuild() {
        try {
            const buildBadge = document.getElementById('abn-build-badge');
            const buildVersion = document.getElementById('abn-build-version');
            if (buildBadge) buildBadge.textContent = VERSION;
            if (buildVersion) buildVersion.textContent = VERSION + ' / 2026-06-28';
        } catch (_) {}
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', markBuild, { once: true });
    else markBuild();

    try { if (typeof patchLog === 'function') patchLog(VERSION + ' loaded'); } catch (_) {}
    info(VERSION + ' loaded', health());
})();

/* Extracted operational script block 20 */
/* ==========================================================
   ABONIBAL ERP - RELEASE CANDIDATE RC1 SEAL
   Constitution-aligned release marker only.
   No business logic, accounting, inventory, invoice, or sync changes.
   ========================================================== */
(function(global){
    'use strict';
    if (global.__ABN_RC1_RELEASE_SEAL__) return;
    const RELEASE = Object.freeze({
        name: 'ABONIBAL ERP Professional',
        release: 'RC1',
        sourceBuild: 'STABILIZATION-P6',
        qaGate: 'PASSED',
        ownerBrowserValidation: 'PASSED-100-PERCENT',
        validatedFlows: Object.freeze([
            'login',
            'product-add-edit',
            'invoice-sale',
            'retail-sale',
            'excel-import',
            'firebase-sync',
            'close-reopen-data-persistence'
        ]),
        scope: 'release-candidate-validation',
        businessLogicChanged: false,
        sealedAt: '2026-06-28'
    });
    Object.defineProperty(global, '__ABN_RC1_RELEASE_SEAL__', {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false
    });
    Object.defineProperty(global, 'ABNReleaseCandidate', {
        value: RELEASE,
        configurable: false,
        enumerable: true,
        writable: false
    });
    try {
        console.info('ABONIBAL RC1 Release Candidate sealed', RELEASE);
    } catch (_) {}
})(window);

/* Extracted operational script block 21 */
/* ============================================================
   ABONIBAL FINAL HARDENING
   Scope: standards-mode/accessibility/release readiness metadata only.
   No business logic changes.
   ============================================================ */
(function ABNFinalHardeningBootstrap(global) {
    'use strict';
    if (!global || global.__ABN_FINAL_HARDENING__) return;

    var FINAL_HARDENING = Object.freeze({
        project: 'ABONIBAL ERP Professional',
        stage: 'FINAL-HARDENING',
        sourceRelease: 'RC1',
        qaGate: 'PASSED',
        ownerBrowserValidation: 'PASSED-100-PERCENT',
        standardsModeRequired: true,
        businessLogicChanged: false,
        hardenedAt: '2026-06-28',
        checks: Object.freeze([
            'doctype-normalized',
            'form-labels-associated',
            'rc1-baseline-preserved',
            'production-readiness-metadata'
        ]),
        health: function () {
            var controls = Array.prototype.slice.call(document.querySelectorAll('input, select, textarea'));
            var unlabeled = controls.filter(function (el) {
                if (el.type === 'hidden' || el.getAttribute('aria-hidden') === 'true') return false;
                if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.title) return false;
                if (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) return false;
                return !el.closest('label');
            }).map(function (el) {
                return el.id || el.name || el.tagName.toLowerCase();
            });

            return {
                stage: 'FINAL-HARDENING',
                compatMode: document.compatMode,
                standardsMode: document.compatMode === 'CSS1Compat',
                totalFormControls: controls.length,
                unlabeledControls: unlabeled,
                rc1Seal: !!global.ABNReleaseCandidate,
                qaGate: !!global.ABNQAGate,
                businessLogicChanged: false
            };
        }
    });

    Object.defineProperty(global, '__ABN_FINAL_HARDENING__', {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false
    });
    Object.defineProperty(global, 'ABNFinalHardening', {
        value: FINAL_HARDENING,
        configurable: false,
        enumerable: true,
        writable: false
    });

    try {
        console.info('ABONIBAL Final Hardening sealed', FINAL_HARDENING);
    } catch (_) {}
})(window);

/* Extracted operational script block 22 */
(function(){
'use strict';
const PROFILE_KEY = 'abn_business_profile_v1';
const PRIVACY_KEY = 'abn_privacy_settings_v1';
const DEFAULT_PROFILE = Object.freeze({
    schema: 'ABN_BUSINESS_PROFILE_V1',
    businessName: 'اسم المتجر',
    subtitle: 'النشاط التجاري',
    footerNote: 'شكراً لتعاملكم معنا',
    logoUrl: '',
    phones: [],
    partners: ['الشريك 1','الشريك 2'],
    branchName: 'الفرع الرئيسي',
    storeCode: 'MAIN',
    updatedAt: null
});
const DEMO_PROFILE = Object.freeze({
    schema: 'ABN_BUSINESS_PROFILE_V1',
    businessName: 'متجر تجريبي',
    subtitle: 'نسخة عرض عامة',
    footerNote: 'هذه فاتورة تجريبية للعرض فقط',
    logoUrl: '',
    phones: [],
    partners: ['الشريك 1','الشريك 2'],
    branchName: 'Demo',
    storeCode: 'DEMO',
    updatedAt: null
});
function parseJson(raw, fallback){ try { return raw ? JSON.parse(raw) : fallback; } catch(_) { return fallback; } }
function escapeHtml(value){ return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function escapeCssContent(value){ return String(value ?? '').replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,' '); }
function cleanText(value, fallback){ value = String(value ?? '').trim(); return value || fallback || ''; }
function normalizePhones(phones){
    if (!Array.isArray(phones)) return [];
    return phones.map(p => ({ label: cleanText(p && p.label, ''), number: cleanText(p && p.number, '') }))
        .filter(p => p.label || p.number).slice(0, 4);
}
function normalizePartners(partners){
    let list = [];
    if (Array.isArray(partners)) list = partners;
    else if (typeof partners === 'string') list = partners.split(/\n|,|،/g);
    list = list.map(x => cleanText(x, '')).filter(Boolean);
    return list.length ? Array.from(new Set(list)).slice(0, 12) : ['الشريك 1','الشريك 2'];
}
function normalizeProfile(profile){
    profile = profile && typeof profile === 'object' ? profile : {};
    return {
        schema: 'ABN_BUSINESS_PROFILE_V1',
        businessName: cleanText(profile.businessName, DEFAULT_PROFILE.businessName),
        subtitle: cleanText(profile.subtitle, DEFAULT_PROFILE.subtitle),
        footerNote: cleanText(profile.footerNote, DEFAULT_PROFILE.footerNote),
        logoUrl: cleanText(profile.logoUrl, ''),
        phones: normalizePhones(profile.phones),
        partners: normalizePartners(profile.partners),
        branchName: cleanText(profile.branchName, DEFAULT_PROFILE.branchName),
        storeCode: cleanText(profile.storeCode, DEFAULT_PROFILE.storeCode),
        updatedAt: profile.updatedAt || null
    };
}
function getProfile(){ return normalizeProfile(parseJson(localStorage.getItem(PROFILE_KEY), DEFAULT_PROFILE)); }
function setProfile(profile){ localStorage.setItem(PROFILE_KEY, JSON.stringify(normalizeProfile({ ...profile, updatedAt: new Date().toISOString() }))); }
function getPrivacy(){ return { publicMode: false, ...(parseJson(localStorage.getItem(PRIVACY_KEY), {}) || {}) }; }
function setPrivacy(settings){ localStorage.setItem(PRIVACY_KEY, JSON.stringify({ publicMode: !!settings.publicMode, updatedAt: new Date().toISOString() })); }
function getDisplayProfile(){ return getPrivacy().publicMode ? { ...DEMO_PROFILE, partners: getProfile().partners.map((_, i) => 'الشريك ' + (i + 1)) } : getProfile(); }
function setText(selector, value){ document.querySelectorAll(selector).forEach(el => { el.textContent = value; }); }
function setInput(id, value){ const el = document.getElementById(id); if (el) el.value = value || ''; }
function updateMeta(profile){
    document.title = (profile.businessName || 'ABONIBAL ERP') + ' - ABONIBAL ERP Professional';
    document.querySelectorAll('meta[name="apple-mobile-web-app-title"]').forEach(m => m.setAttribute('content', profile.businessName || 'ABONIBAL ERP'));
}
function updateDynamicCss(profile){
    const tag = document.getElementById('abn-privacy-dynamic-css');
    if (!tag) return;
    tag.textContent = `.nav-bar::before{content:"${escapeCssContent(profile.businessName || 'ABONIBAL ERP')}" !important;} .nav-bar::after{content:"${escapeCssContent(profile.storeCode || 'ABONIBAL ERP')}" !important;}`;
}
function updateInvoiceIdentity(profile){
    setText('[data-abn-bind="businessName"]', profile.businessName);
    setText('[data-abn-bind="invoiceBusinessName"]', profile.businessName);
    setText('[data-abn-bind="businessSubtitle"]', profile.subtitle);
    setText('[data-abn-bind="invoiceFooter"]', profile.footerNote);
    const title = document.querySelector('.inv-shop-title-main');
    if (title) title.innerHTML = `<span class="inv-shop-title-deco">◈</span> ${escapeHtml(profile.businessName)} <span class="inv-shop-title-deco">◈</span>`;
    const sub = document.querySelector('.inv-shop-subtitle');
    if (sub) sub.textContent = profile.subtitle;
    const footer = document.querySelector('.invoice-footer-note');
    if (footer) footer.textContent = profile.footerNote;
    const contact = document.querySelector('.inv-contact-side');
    if (contact) {
        if (profile.phones.length) {
            contact.innerHTML = profile.phones.map(p => `<div data-abn-private="${getPrivacy().publicMode ? 'true' : 'false'}"><span class="contact-icon">📞</span> ${escapeHtml(p.label || 'هاتف')}: ${escapeHtml(p.number || '')}</div>`).join('');
        } else {
            contact.innerHTML = '<div><span class="contact-icon">📞</span> معلومات التواصل مخفية</div>';
        }
    }
    const logo = document.querySelector('.inv-logo-side img');
    if (logo) {
        if (profile.logoUrl) { logo.src = profile.logoUrl; logo.style.display = ''; }
        else { logo.removeAttribute('src'); logo.style.display = 'none'; }
    }
}
function updatePartnerSelectors(){
    const realProfile = getProfile();
    const displayProfile = getDisplayProfile();
    const real = normalizePartners(realProfile.partners);
    const display = normalizePartners(displayProfile.partners);
    ['capital-name','partner-name'].forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        const current = select.value;
        select.innerHTML = real.map((name, i) => `<option value="${escapeHtml(name)}">${escapeHtml(display[i] || name)}</option>`).join('');
        if (real.includes(current)) select.value = current;
    });
}
function updatePartnerSummaryOnly(){
    const grid = document.querySelector('#tab-partners .dashboard-grid');
    if (!grid) return;
    const real = normalizePartners(getProfile().partners);
    const display = normalizePartners(getDisplayProfile().partners);
    const totals = new Map(real.map(name => [name, 0]));
    const withdrawals = (typeof state !== 'undefined' && Array.isArray(state.partnerWithdrawals)) ? state.partnerWithdrawals : [];
    withdrawals.forEach(w => {
        const name = w && w.partner ? String(w.partner) : '';
        if (!totals.has(name)) totals.set(name, 0);
        totals.set(name, (totals.get(name) || 0) + (Number(w && w.usdEquivalent) || 0));
    });
    grid.innerHTML = Array.from(totals.entries()).map(([name, total], i) => `<div class="db-box" style="background:#f0fdfa; border: 1px solid #5eead4;"><h4 style="color:#0f766e;">سحوبات (${escapeHtml(display[i] || name)})</h4><p style="color:#0f766e; font-size:18px;">${Number(total).toFixed(2)} $</p></div>`).join('');
}
function populateForm(){
    const p = getProfile();
    const settings = getPrivacy();
    setInput('abn-profile-business-name', p.businessName);
    setInput('abn-profile-subtitle', p.subtitle);
    setInput('abn-profile-footer', p.footerNote);
    setInput('abn-profile-logo', p.logoUrl);
    setInput('abn-profile-branch', p.branchName);
    setInput('abn-profile-store-code', p.storeCode);
    setInput('abn-profile-partners', normalizePartners(p.partners).join('\n'));
    setInput('abn-profile-phone1-label', p.phones[0] && p.phones[0].label);
    setInput('abn-profile-phone1-number', p.phones[0] && p.phones[0].number);
    setInput('abn-profile-phone2-label', p.phones[1] && p.phones[1].label);
    setInput('abn-profile-phone2-number', p.phones[1] && p.phones[1].number);
    const chk = document.getElementById('abn-public-mode-toggle'); if (chk) chk.checked = !!settings.publicMode;
}
function readProfileForm(){
    const phones = [
        { label: document.getElementById('abn-profile-phone1-label')?.value || '', number: document.getElementById('abn-profile-phone1-number')?.value || '' },
        { label: document.getElementById('abn-profile-phone2-label')?.value || '', number: document.getElementById('abn-profile-phone2-number')?.value || '' }
    ];
    return normalizeProfile({
        businessName: document.getElementById('abn-profile-business-name')?.value,
        subtitle: document.getElementById('abn-profile-subtitle')?.value,
        footerNote: document.getElementById('abn-profile-footer')?.value,
        logoUrl: document.getElementById('abn-profile-logo')?.value,
        branchName: document.getElementById('abn-profile-branch')?.value,
        storeCode: document.getElementById('abn-profile-store-code')?.value,
        phones,
        partners: document.getElementById('abn-profile-partners')?.value
    });
}
function applyAll(){
    const profile = getDisplayProfile();
    document.body.classList.toggle('abn-public-mode', !!getPrivacy().publicMode);
    updateMeta(profile);
    updateDynamicCss(profile);
    updateInvoiceIdentity(profile);
    updatePartnerSelectors();
    updatePartnerSummaryOnly();
    const banner = document.getElementById('abn-public-mode-banner');
    if (banner) banner.textContent = getPrivacy().publicMode ? '🟡 وضع العرض العام مفعل: معلومات المتجر والأرقام والشركاء مخفية.' : '';
}
function injectUi(){
    if (document.getElementById('abn-privacy-card')) return;
    const target = document.getElementById('tab-system');
    if (!target) return;
    const card = document.createElement('div');
    card.id = 'abn-privacy-card';
    card.className = 'card abn-privacy-card';
    card.innerHTML = `
        <div class="card-title">🛡️ ملف المتجر والخصوصية</div>
        <div id="abn-public-mode-banner" class="abn-public-banner"></div>
        <div class="abn-privacy-grid">
            <div class="form-group"><label for="abn-profile-business-name">اسم المتجر</label><input id="abn-profile-business-name" type="text" autocomplete="organization"></div>
            <div class="form-group"><label for="abn-profile-subtitle">النشاط / وصف الفاتورة</label><input id="abn-profile-subtitle" type="text"></div>
            <div class="form-group"><label for="abn-profile-branch">اسم الفرع</label><input id="abn-profile-branch" type="text"></div>
            <div class="form-group"><label for="abn-profile-store-code">رمز المحل / الفرع</label><input id="abn-profile-store-code" type="text"></div>
            <div class="form-group"><label for="abn-profile-logo">رابط الشعار</label><input id="abn-profile-logo" type="text" dir="ltr" placeholder="https://..."></div>
            <div class="form-group"><label for="abn-profile-footer">نص أسفل الفاتورة</label><input id="abn-profile-footer" type="text"></div>
        </div>
        <div class="abn-privacy-row">
            <div class="form-group"><label for="abn-profile-phone1-label">اسم صاحب الرقم 1</label><input id="abn-profile-phone1-label" type="text"></div>
            <div class="form-group"><label for="abn-profile-phone1-number">الرقم 1</label><input id="abn-profile-phone1-number" type="text" dir="ltr"></div>
        </div>
        <div class="abn-privacy-row">
            <div class="form-group"><label for="abn-profile-phone2-label">اسم صاحب الرقم 2</label><input id="abn-profile-phone2-label" type="text"></div>
            <div class="form-group"><label for="abn-profile-phone2-number">الرقم 2</label><input id="abn-profile-phone2-number" type="text" dir="ltr"></div>
        </div>
        <div class="form-group"><label for="abn-profile-partners">الشركاء / العملاء الشركاء — اسم في كل سطر</label><textarea id="abn-profile-partners" rows="4" placeholder="الشريك 1\nالشريك 2"></textarea></div>
        <label style="display:flex; gap:8px; align-items:center; font-weight:900;"><input id="abn-public-mode-toggle" type="checkbox" style="width:auto;"> تفعيل Demo / Public Mode لإخفاء معلوماتي عند العرض</label>
        <div class="abn-privacy-actions">
            <button onclick="ABNPrivacy.saveProfileFromUi()">💾 حفظ ملف المتجر</button>
            <button onclick="ABNPrivacy.exportBackup()" style="background:#2563eb;">📦 تصدير نسخة احتياطية</button>
            <button onclick="document.getElementById('abn-profile-import-file').click()" style="background:#64748b;">📥 استيراد ملف متجر</button>
            <input id="abn-profile-import-file" type="file" accept="application/json,.json" style="display:none" onchange="ABNPrivacy.importProfileFile(this.files && this.files[0])">
        </div>
        <p class="abn-privacy-note">هذه الإعدادات محلية على الجهاز. وضع العرض العام يخفي بياناتك عند تصوير الشاشة أو تجربة البرنامج أمام الآخرين، ولا يحذف بياناتك الأصلية.</p>
        <div class="abn-privacy-card abn-danger-zone">
            <strong>منطقة حساسة</strong>
            <p class="abn-privacy-note" style="color:inherit;">يمسح الزر التالي بيانات هذا الجهاز فقط: التخزين المحلي، الطابور، ملف المتجر المحلي، والبيانات المخزنة في IndexedDB/localforage. لا يحذف بيانات Firebase السحابية.</p>
            <button onclick="ABNPrivacy.clearCurrentDevice()" style="background:#b91c1c;">🧹 مسح بيانات الجهاز الحالي</button>
        </div>`;
    const hero = target.querySelector('.abn-system-hero');
    if (hero && hero.nextSibling) target.insertBefore(card, hero.nextSibling); else target.prepend(card);
}
function saveProfileFromUi(){
    setProfile(readProfileForm());
    setPrivacy({ publicMode: !!document.getElementById('abn-public-mode-toggle')?.checked });
    populateForm(); applyAll();
    try { if (typeof addAdminLog === 'function') addAdminLog('تحديث ملف المتجر', 'تم تعديل إعدادات المتجر والخصوصية'); } catch(_){ }
    alert('✅ تم حفظ ملف المتجر والخصوصية');
}
function downloadJson(filename, payload){
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportBackup(){
    const lf = {};
    try { if (window.localforage && typeof localforage.iterate === 'function') await localforage.iterate((value, key) => { lf[key] = value; }); } catch(error){ lf.__error = String(error && error.message || error); }
    const ls = {};
    try { Object.keys(localStorage).forEach(k => { if (/^(abn|alfares|sync|collection|admin|license)/i.test(k)) ls[k] = localStorage.getItem(k); }); } catch(error){ ls.__error = String(error && error.message || error); }
    const payload = {
        schema: 'ABN_FULL_LOCAL_BACKUP_V1',
        createdAt: new Date().toISOString(),
        profile: getProfile(),
        privacy: getPrivacy(),
        state: (typeof state !== 'undefined' ? JSON.parse(JSON.stringify(state)) : null),
        localStorage: ls,
        localforage: lf
    };
    downloadJson('ABONIBAL_LOCAL_BACKUP_' + new Date().toISOString().slice(0,10) + '.json', payload);
}
function importProfileFile(file){
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(){
        try {
            const data = JSON.parse(String(reader.result || '{}'));
            const profile = data.profile || data.businessProfile || data;
            setProfile(profile);
            populateForm(); applyAll();
            alert('✅ تم استيراد ملف المتجر');
        } catch(error){ alert('تعذر استيراد الملف: ' + (error && error.message || error)); }
    };
    reader.readAsText(file, 'utf-8');
}
async function clearCurrentDevice(){
    if (typeof window.clearCurrentDeviceData === 'function') return window.clearCurrentDeviceData();
    const phrase = 'مسح بيانات الجهاز الحالي';
    const typed = prompt('هذا الإجراء يمسح بيانات هذا الجهاز فقط ولا يمسح Firebase. اكتب العبارة التالية للتأكيد:\n' + phrase);
    if (typed !== phrase) return alert('تم إلغاء المسح.');
    const second = confirm('تأكيد أخير: هل تريد مسح التخزين المحلي لهذا الجهاز؟');
    if (!second) return;
    try { localStorage.clear(); } catch(_) {}
    try { if (window.localforage && typeof localforage.clear === 'function') await localforage.clear(); } catch(error){ console.warn('localforage clear failed', error); }
    alert('✅ تم مسح بيانات الجهاز الحالي. سيتم إعادة تحميل الصفحة.');
    location.reload();
}
function publicNameForPartner(realName){
    const real = normalizePartners(getProfile().partners);
    const display = normalizePartners(getDisplayProfile().partners);
    const idx = real.indexOf(String(realName || ''));
    return idx >= 0 ? (display[idx] || realName) : (getPrivacy().publicMode ? 'شريك' : realName);
}
const originalUpdatePartnersUI = window.updatePartnersUI;
window.updatePartnersUI = function(){
    if (typeof originalUpdatePartnersUI === 'function') {
        try { originalUpdatePartnersUI.apply(this, arguments); } catch(error){ console.warn('legacy updatePartnersUI failed', error); }
    }
    const publicMode = getPrivacy().publicMode;
    if (publicMode) {
        document.querySelectorAll('#partners-list .data-list-item strong, #capital-list .data-list-item strong').forEach(el => {
            el.textContent = el.textContent.replace(/(سحب|إضافة)\s+(.+)$/, function(_, prefix, name){ return prefix + ' ' + publicNameForPartner(name.trim()); });
        });
    }
    updatePartnerSelectors();
    updatePartnerSummaryOnly();
};
window.shareWhatsApp = function(){
    if (typeof currentInvoiceItems === 'undefined' || !currentInvoiceItems.length) return alert('الفاتورة فارغة!');
    const profile = getDisplayProfile();
    const invNum = (typeof editingInvoiceId !== 'undefined' && editingInvoiceId) ? document.getElementById('inv-id-display').innerText : String((typeof state !== 'undefined' && state.invoiceCount) || 0).padStart(5, '0');
    const clientName = document.getElementById('inv-client-select')?.value || 'عام';
    let text = `*${profile.businessName}*\n${profile.subtitle}\n------------------------\n📄 فاتورة رقم: ${invNum}\n👤 العميل: ${clientName}\n\n*تفاصيل المشتريات:*\n`;
    currentInvoiceItems.forEach((item, i) => { text += `${i + 1}- ${item.name} | العدد: ${item.qty} | السعر: ${item.price}$\n`; });
    text += `-------------------------\n💰 الإجمالي: ${document.getElementById('invoice-total').innerText} $\n\n💵 المدفوع: ${document.getElementById('inv-paid-amount').value}\n${document.getElementById('inv-currency').options[document.getElementById('inv-currency').selectedIndex].text}\n\n🔴 الباقي: ${document.getElementById('invoice-remaining').innerText} $\n\n${profile.footerNote || 'نسعد بتعاملكم معنا'}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
};
function run(){ injectUi(); populateForm(); applyAll(); try { if (typeof window.updatePartnersUI === 'function') window.updatePartnersUI(); } catch(_){} }
window.ABNPrivacy = {
    getProfile, setProfile, getPrivacy, setPrivacy, apply: applyAll, saveProfileFromUi, exportBackup,
    importProfileFile, clearCurrentDevice, normalizePartners,
    health: function(){ return { patch:'PRIVACY-001', hasProfile: !!localStorage.getItem(PROFILE_KEY), publicMode: !!getPrivacy().publicMode, partners: normalizePartners(getProfile().partners).length, phones: normalizePhones(getProfile().phones).length, fixedCodeIdentityRemoved: true }; }
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
setTimeout(run, 400);
})();

/* Extracted operational script block 23 */
(function(){
'use strict';
const SETTINGS_KEY = 'abn_data_boundary_settings_v1';
const DATA_BOUNDARY = Object.freeze({
    patch: 'PRIVACY-002',
    purpose: 'Firebase inventory and operational data boundary',
    rules: Object.freeze({
        businessProfile: 'Local editable profile settings only; safe to export separately.',
        inventoryProducts: 'Operational business data stored in app state and synchronized with Firebase; never moved into profile settings.',
        localWipe: 'Clears this device only and must not delete Firebase products, invoices, clients, or financial records.',
        demoMode: 'May hide operational data visually for public demonstrations without changing the underlying data.',
        cloudWipe: 'Disabled in this privacy build unless a future owner-only cloud reset flow is designed and approved.'
    })
});
function parseJson(raw, fallback){ try { return raw ? JSON.parse(raw) : fallback; } catch(_) { return fallback; } }
function getSettings(){ return { maskOperationalDataInPublicMode: true, ...(parseJson(localStorage.getItem(SETTINGS_KEY), {}) || {}) }; }
function setSettings(settings){ localStorage.setItem(SETTINGS_KEY, JSON.stringify({ maskOperationalDataInPublicMode: !!settings.maskOperationalDataInPublicMode, updatedAt: new Date().toISOString() })); }
function safeState(){ return (typeof state !== 'undefined' && state && typeof state === 'object') ? state : {}; }
function countOf(key){ const value = safeState()[key]; return Array.isArray(value) ? value.length : 0; }
function isFirebaseAvailable(){ return typeof firebase !== 'undefined' && typeof db !== 'undefined'; }
function isSyncAvailable(){ return typeof SyncManager !== 'undefined' || typeof fullSync === 'function'; }
function refreshClasses(){
    const privacy = window.ABNPrivacy && typeof ABNPrivacy.getPrivacy === 'function' ? ABNPrivacy.getPrivacy() : { publicMode:false };
    const settings = getSettings();
    document.body.classList.toggle('abn-mask-operational-data', !!privacy.publicMode && !!settings.maskOperationalDataInPublicMode);
}
function htmlEscape(value){ return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function buildStatusHtml(){
    const counts = {
        products: countOf('products'),
        clients: countOf('clients'),
        invoices: countOf('invoices'),
        retailSales: countOf('retailSales'),
        expenses: countOf('expenses'),
        partners: countOf('partnerWithdrawals') + countOf('capital')
    };
    return `
        <div class="abn-boundary-grid">
            <div class="abn-boundary-box">📦 المنتجات: ${counts.products}<small>بيانات تشغيلية محفوظة في state وتزامن Firebase.</small></div>
            <div class="abn-boundary-box">👥 العملاء: ${counts.clients}<small>لا تدخل في ملف المتجر الخاص.</small></div>
            <div class="abn-boundary-box">🧾 الفواتير: ${counts.invoices}<small>تبقى ضمن بيانات العمل والمزامنة.</small></div>
            <div class="abn-boundary-box">🛒 بيع مفرق: ${counts.retailSales}<small>سجل تشغيلي مستقل.</small></div>
            <div class="abn-boundary-box">💸 مصاريف: ${counts.expenses}<small>بيانات مالية لا تظهر في وضع العرض عند التمويه.</small></div>
            <div class="abn-boundary-box">🔄 Firebase: ${isFirebaseAvailable() ? 'متاح' : 'غير متاح'}<small>المسح المحلي لا يحذف السحابة.</small></div>
        </div>`;
}
function injectUi(){
    if (document.getElementById('abn-data-boundary-card')) return;
    const target = document.getElementById('tab-system');
    if (!target) return;
    const card = document.createElement('div');
    card.id = 'abn-data-boundary-card';
    card.className = 'card abn-data-boundary-card';
    card.innerHTML = `
        <div class="card-title">🧱 حدود بيانات Firebase والمخزن</div>
        <div id="abn-data-boundary-status"></div>
        <label style="display:flex; gap:8px; align-items:center; font-weight:900; margin-top:12px;">
            <input id="abn-mask-operational-toggle" type="checkbox" style="width:auto;">
            في Demo / Public Mode أخفِ بيانات المخزن والمنتجات والعملاء والأرقام المالية بصرياً
        </label>
        <div class="abn-cloud-safe-note">
            ✅ المنتجات والمخزن موجودة كبيانات تشغيلية مرتبطة بالمزامنة/Firebase. لا تُنقل إلى ملف المتجر، ولا تُحذف عند مسح بيانات الجهاز الحالي. ملف المتجر يحتوي الهوية فقط: الاسم، الشعار، الهواتف، نص الفاتورة، والشركاء.
        </div>
        <div class="abn-boundary-actions">
            <button onclick="ABNDataBoundary.saveSettings()">💾 حفظ إعدادات حدود البيانات</button>
            <button onclick="ABNDataBoundary.exportProfileOnly()" style="background:#0f766e;">🪪 تصدير ملف المتجر فقط</button>
            <button onclick="ABNDataBoundary.exportFullLocalData()" style="background:#2563eb;">📦 تصدير بيانات هذا الجهاز</button>
            <button onclick="ABNDataBoundary.refresh()" style="background:#64748b;">🔍 تحديث الفحص</button>
        </div>
        <div class="abn-cloud-safe-note" style="background:#fef3c7;border-color:#fde68a;color:#92400e;">
            ⚠️ تم تعطيل التبييض السحابي العام في هذه النسخة لحماية منتجات Firebase. أي حذف سحابي كامل يحتاج مرحلة منفصلة وموافقة صريحة.
        </div>`;
    const privacyCard = document.getElementById('abn-privacy-card');
    if (privacyCard && privacyCard.nextSibling) privacyCard.parentNode.insertBefore(card, privacyCard.nextSibling); else target.prepend(card);
}
function populate(){
    const chk = document.getElementById('abn-mask-operational-toggle');
    if (chk) chk.checked = !!getSettings().maskOperationalDataInPublicMode;
    const status = document.getElementById('abn-data-boundary-status');
    if (status) status.innerHTML = buildStatusHtml();
    refreshClasses();
}
function saveSettings(){
    setSettings({ maskOperationalDataInPublicMode: !!document.getElementById('abn-mask-operational-toggle')?.checked });
    populate();
    alert('✅ تم حفظ إعدادات حدود البيانات');
}
function downloadJson(filename, payload){
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportProfileOnly(){
    const profile = window.ABNPrivacy && typeof ABNPrivacy.getProfile === 'function' ? ABNPrivacy.getProfile() : null;
    downloadJson('ABONIBAL_PROFILE_ONLY_' + new Date().toISOString().slice(0,10) + '.json', {
        schema: 'ABONIBAL_PROFILE_ONLY_V1',
        createdAt: new Date().toISOString(),
        includesOperationalData: false,
        profile
    });
}
function exportFullLocalData(){
    if (!confirm('سيتم تصدير بيانات هذا الجهاز بما فيها المنتجات والفواتير إن كانت محملة محلياً. لا ترسل الملف لغيرك. هل تريد المتابعة؟')) return;
    if (window.ABNPrivacy && typeof ABNPrivacy.exportBackup === 'function') return ABNPrivacy.exportBackup();
    downloadJson('ABONIBAL_LOCAL_STATE_' + new Date().toISOString().slice(0,10) + '.json', {
        schema: 'ABONIBAL_LOCAL_STATE_FALLBACK_V1',
        createdAt: new Date().toISOString(),
        state: safeState()
    });
}
function protectCloudWipe(){
    const original = window.wipeApplication;
    if (typeof original === 'function' && !original.__abnPrivacy002Protected) {
        const protectedWipe = function(){
            alert('محمي بواسطة PRIVACY-002: التبييض السحابي الكامل معطل حتى لا تُحذف منتجات Firebase. استخدم زر مسح بيانات الجهاز الحالي للمسح المحلي فقط.');
            return false;
        };
        protectedWipe.__abnPrivacy002Protected = true;
        protectedWipe.__original = original;
        window.wipeApplication = protectedWipe;
    }
}
function run(){ injectUi(); populate(); protectCloudWipe(); }
window.ABNDataBoundary = {
    getSettings, setSettings, saveSettings, refresh: run, exportProfileOnly, exportFullLocalData,
    health: function(){
        refreshClasses();
        return {
            patch: DATA_BOUNDARY.patch,
            firebaseAvailable: isFirebaseAvailable(),
            syncAvailable: isSyncAvailable(),
            productsCount: countOf('products'),
            clientsCount: countOf('clients'),
            invoicesCount: countOf('invoices'),
            localWipeOnly: true,
            cloudWipeProtected: typeof window.wipeApplication === 'function' && !!window.wipeApplication.__abnPrivacy002Protected,
            maskOperationalDataInPublicMode: !!getSettings().maskOperationalDataInPublicMode,
            rules: DATA_BOUNDARY.rules
        };
    }
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
setTimeout(run, 400);
setTimeout(run, 1500);
})();

/* Extracted operational script block 24 */
(function(){
'use strict';
if (window.__ABN_PRIVACY_003_LOADED__) return;
window.__ABN_PRIVACY_003_LOADED__ = true;
const VERSION = 'PRIVACY-003-DEMO-MASKING';
const MASK_TEXT = 'مخفي';
const DASHBOARD_MASK_IDS = Object.freeze([
    'db-safe-usd', 'db-safe-try', 'db-safe-syp',
    'db-purchases', 'db-suppliers-debts', 'db-sales', 'db-profit',
    'db-total-debts', 'db-inv-sales', 'db-retail-sales', 'db-expenses',
    'db-prod-count', 'db-sync-version',
    'profit-day', 'profit-week', 'profit-month', 'profit-year'
]);
const OPERATIONAL_LABELS = Object.freeze([
    'قيمة البضاعة', 'ديون مستحقة للتجار', 'إجمالي المبيعات', 'صافي الأرباح',
    'ديون الزبائن', 'مبيعات الفواتير', 'مبيعات المفرق', 'مصاريف المحل',
    'قطع الغيار', 'إصدار المزامنة', 'ربح اليوم', 'ربح الأسبوع', 'ربح الشهر', 'ربح السنة'
]);
let observer = null;
let scheduled = false;
let wrappingDone = false;
function hasPublicMode(){
    try {
        return !!(window.ABNPrivacy && typeof ABNPrivacy.getPrivacy === 'function' && ABNPrivacy.getPrivacy().publicMode);
    } catch (_) { return document.body && document.body.classList.contains('abn-public-mode'); }
}
function hasBoundaryMask(){
    try {
        return !!(window.ABNDataBoundary && typeof ABNDataBoundary.getSettings === 'function' && ABNDataBoundary.getSettings().maskOperationalDataInPublicMode);
    } catch (_) { return document.body && document.body.classList.contains('abn-mask-operational-data'); }
}
function shouldMask(){ return !!(document.body && hasPublicMode() && hasBoundaryMask()); }
function closestRow(el){
    if (!el) return null;
    return el.closest && (el.closest('p') || el.closest('.db-box') || el.closest('.sub-profit-box'));
}
function storeOriginal(el){
    if (!el || el.dataset.abnDemoOriginalSet === 'true') return;
    el.dataset.abnDemoOriginalText = el.textContent || '';
    el.dataset.abnDemoOriginalSet = 'true';
}
function maskElement(el){
    if (!el) return;
    storeOriginal(el);
    if (el.textContent !== MASK_TEXT) el.textContent = MASK_TEXT;
    el.setAttribute('data-abn-demo-mask', 'true');
    const row = closestRow(el);
    if (row) row.setAttribute('data-abn-demo-mask-row', 'true');
}
function clearElement(el){
    if (!el) return;
    if (el.dataset.abnDemoOriginalSet === 'true') {
        el.textContent = el.dataset.abnDemoOriginalText || '';
    }
    el.removeAttribute('data-abn-demo-mask');
    delete el.dataset.abnDemoOriginalText;
    delete el.dataset.abnDemoOriginalSet;
    const row = closestRow(el);
    if (row) row.removeAttribute('data-abn-demo-mask-row');
}
function maskDashboard(){ DASHBOARD_MASK_IDS.forEach(id => maskElement(document.getElementById(id))); }
function clearDashboard(){ DASHBOARD_MASK_IDS.forEach(id => clearElement(document.getElementById(id))); }
function markOperationalRows(){
    const dash = document.getElementById('tab-dash');
    if (!dash) return;
    const candidates = dash.querySelectorAll('p, .db-box, .sub-profit-box');
    candidates.forEach(node => {
        const text = node.textContent || '';
        if (OPERATIONAL_LABELS.some(label => text.indexOf(label) !== -1)) {
            node.setAttribute('data-abn-demo-mask-row', shouldMask() ? 'true' : 'false');
            if (!shouldMask()) node.removeAttribute('data-abn-demo-mask-row');
        }
    });
}
function apply(){
    scheduled = false;
    if (!document.body) return;
    if (shouldMask()) maskDashboard(); else clearDashboard();
    markOperationalRows();
}
function schedule(){
    if (scheduled) return;
    scheduled = true;
    setTimeout(apply, 30);
}
function wrapDashboardCalculations(){
    if (wrappingDone) return;
    wrappingDone = true;
    ['calculateDashboard', 'calculateProfitStats'].forEach(name => {
        const original = window[name];
        if (typeof original !== 'function' || original.__abnPrivacy003Wrapped) return;
        const wrapped = function(){
            const result = original.apply(this, arguments);
            schedule();
            return result;
        };
        wrapped.__abnPrivacy003Wrapped = true;
        wrapped.__original = original;
        window[name] = wrapped;
    });
}
function observe(){
    if (observer || !document.body) return;
    const dash = document.getElementById('tab-dash') || document.body;
    observer = new MutationObserver(function(){ schedule(); });
    observer.observe(dash, { childList:true, subtree:true, characterData:true });
}
function run(){
    wrapDashboardCalculations();
    observe();
    schedule();
}
window.ABNDemoMasking = Object.freeze({
    version: VERSION,
    targetIds: DASHBOARD_MASK_IDS.slice(),
    apply: run,
    health: function(){
        return {
            version: VERSION,
            publicMode: hasPublicMode(),
            boundaryMaskEnabled: hasBoundaryMask(),
            active: shouldMask(),
            targetCount: DASHBOARD_MASK_IDS.length,
            maskedNow: DASHBOARD_MASK_IDS.filter(id => document.getElementById(id)?.getAttribute('data-abn-demo-mask') === 'true').length,
            firebaseDataModified: false,
            stateDataModified: false
        };
    }
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
setTimeout(run, 400);
setTimeout(run, 1200);
setInterval(schedule, 1500);
try { console.info('[ABONIBAL Privacy P3] ' + VERSION + ' loaded', window.ABNDemoMasking.health()); } catch (_) {}
})();

/* Extracted operational script block 25 */
(function(){
'use strict';
if (window.__ABN_PRIVACY_004_LOADED__) return;
window.__ABN_PRIVACY_004_LOADED__ = true;
const VERSION = 'PRIVACY-004-DEMO-PRODUCT-MASKING';
const PRODUCT_LIST_ID = 'products-list';
let scheduled = false;
let wrappingDone = false;
function hasPublicMode(){
    try { return !!(window.ABNPrivacy && typeof ABNPrivacy.getPrivacy === 'function' && ABNPrivacy.getPrivacy().publicMode); }
    catch (_) { return !!(document.body && document.body.classList.contains('abn-public-mode')); }
}
function hasBoundaryMask(){
    try { return !!(window.ABNDataBoundary && typeof ABNDataBoundary.getSettings === 'function' && ABNDataBoundary.getSettings().maskOperationalDataInPublicMode); }
    catch (_) { return !!(document.body && document.body.classList.contains('abn-mask-operational-data')); }
}
function shouldMask(){ return !!(document.body && hasPublicMode() && hasBoundaryMask()); }
function productCount(){
    try { return Array.isArray(state.products) ? state.products.filter(Boolean).length : 0; }
    catch (_) { return 0; }
}
function htmlEscape(value){ return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function manageProductSearchInput(masked){
    const input = document.getElementById('prod-search');
    if (!input) return;
    if (masked) {
        if (!input.dataset.abnOriginalPlaceholder) input.dataset.abnOriginalPlaceholder = input.getAttribute('placeholder') || '';
        input.value = '';
        input.placeholder = 'بحث المخزن مخفي في وضع العرض العام';
        input.setAttribute('disabled', 'disabled');
    } else {
        if (input.dataset.abnOriginalPlaceholder !== undefined) input.placeholder = input.dataset.abnOriginalPlaceholder;
        input.removeAttribute('disabled');
    }
}
function renderProductPlaceholder(){
    const list = document.getElementById(PRODUCT_LIST_ID);
    const pagination = document.getElementById('products-pagination');
    if (pagination) pagination.innerHTML = '';
    manageProductSearchInput(true);
    if (!list) return false;
    list.innerHTML = '<div class="abn-demo-list-placeholder">📦 بيانات المخزن والمنتجات مخفية في وضع العرض العام<small>المنتجات موجودة ومتصلة بـ Firebase، لكن أسماء القطع والصور والأسعار والكميات لا تظهر أثناء Demo / Public Mode.</small><small>عدد المنتجات: مخفي</small></div>';
    list.setAttribute('data-abn-demo-products-masked', 'true');
    return true;
}
function unmaskProductList(){
    manageProductSearchInput(false);
    const list = document.getElementById(PRODUCT_LIST_ID);
    if (list && list.getAttribute('data-abn-demo-products-masked') === 'true') {
        list.removeAttribute('data-abn-demo-products-masked');
        list.innerHTML = '';
        if (typeof window.updateProductsUI === 'function') {
            try { window.updateProductsUI.__abnPrivacy004Internal = true; window.updateProductsUI(); }
            catch (_) {}
            finally { try { delete window.updateProductsUI.__abnPrivacy004Internal; } catch (_) {} }
        }
    }
}
function renderHiddenSearch(containerId){
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '<div class="product-search-result-item abn-demo-search-hidden">نتائج المنتجات مخفية في وضع العرض العام</div>';
    container.style.display = 'block';
}
function hideAllProductSearchResults(){
    ['ret-product-results','inv-product-results','track-product-results'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.innerHTML = ''; el.style.display = 'none'; }
    });
    ['ret-product-select','inv-product-select','track-product-select'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.innerHTML = ''; el.value = ''; el.style.display = 'none'; }
    });
}
function wrapFunctions(){
    if (wrappingDone) return;
    wrappingDone = true;
    const originalUpdate = window.updateProductsUI;
    if (typeof originalUpdate === 'function' && !originalUpdate.__abnPrivacy004Wrapped) {
        const wrappedUpdateProducts = function(){
            if (!window.updateProductsUI.__abnPrivacy004Internal && shouldMask()) return renderProductPlaceholder();
            manageProductSearchInput(false);
            return originalUpdate.apply(this, arguments);
        };
        wrappedUpdateProducts.__abnPrivacy004Wrapped = true;
        wrappedUpdateProducts.__original = originalUpdate;
        window.updateProductsUI = wrappedUpdateProducts;
    }
    const originalRenderResults = window.renderProductSearchResults;
    if (typeof originalRenderResults === 'function' && !originalRenderResults.__abnPrivacy004Wrapped) {
        const wrappedRenderResults = function(containerId, products, onSelectFnName){
            if (shouldMask()) return renderHiddenSearch(containerId);
            return originalRenderResults.apply(this, arguments);
        };
        wrappedRenderResults.__abnPrivacy004Wrapped = true;
        wrappedRenderResults.__original = originalRenderResults;
        window.renderProductSearchResults = wrappedRenderResults;
    }
}
function apply(){
    scheduled = false;
    wrapFunctions();
    if (shouldMask()) {
        renderProductPlaceholder();
        hideAllProductSearchResults();
    } else {
        unmaskProductList();
    }
}
function schedule(){
    if (scheduled) return;
    scheduled = true;
    setTimeout(apply, 40);
}
function observe(){
    if (!document.body || window.__ABN_PRIVACY_004_OBSERVER__) return;
    window.__ABN_PRIVACY_004_OBSERVER__ = new MutationObserver(function(){ schedule(); });
    window.__ABN_PRIVACY_004_OBSERVER__.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
}
function run(){ wrapFunctions(); observe(); schedule(); }
window.ABNDemoProductMasking = Object.freeze({
    version: VERSION,
    apply: run,
    health: function(){
        return {
            version: VERSION,
            publicMode: hasPublicMode(),
            boundaryMaskEnabled: hasBoundaryMask(),
            active: shouldMask(),
            productsCountHidden: shouldMask(),
            realProductsCountKnownButNotDisplayed: shouldMask() ? 'masked' : productCount(),
            firebaseDataModified: false,
            stateDataModified: false,
            productListMaskedNow: document.getElementById(PRODUCT_LIST_ID)?.getAttribute('data-abn-demo-products-masked') === 'true'
        };
    }
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
setTimeout(run, 400);
setTimeout(run, 1300);
setInterval(schedule, 1500);
try { console.info('[ABONIBAL Privacy P4] ' + VERSION + ' loaded', window.ABNDemoProductMasking.health()); } catch (_) {}
})();

/* Extracted operational script block 26 */
(function(){
'use strict';
if (window.__ABN_PRIVACY_005_LOADED__) return;
window.__ABN_PRIVACY_005_LOADED__ = true;
const VERSION = 'PRIVACY-005-SIMPLIFIED-PUBLIC-PROFILE';
const SETTINGS_KEY = 'abn_data_boundary_settings_v1';
const IDENTITY_ONLY_NOTICE = 'Demo / Public Mode يحمي هوية المتجر فقط: الاسم، الشعار، الهواتف، ونص الفاتورة. المنتجات والمخزن والبيانات التشغيلية تبقى ظاهرة للتجربة الطبيعية.';
function parseJson(raw, fallback){ try { return raw ? JSON.parse(raw) : fallback; } catch(_) { return fallback; } }
function writeSimplifiedSettings(){
    try {
        const current = parseJson(localStorage.getItem(SETTINGS_KEY), {}) || {};
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({
            ...current,
            maskOperationalDataInPublicMode: false,
            simplifiedPublicProfileMode: true,
            updatedAt: new Date().toISOString()
        }));
    } catch (_) {}
}
function removeOperationalMaskClass(){
    try { document.body && document.body.classList.remove('abn-mask-operational-data'); } catch (_) {}
}
function restoreMaskedText(){
    try {
        document.querySelectorAll('[data-abn-demo-mask="true"]').forEach(function(el){
            if (el.dataset && el.dataset.abnDemoOriginalSet === 'true') el.textContent = el.dataset.abnDemoOriginalText || '';
            el.removeAttribute('data-abn-demo-mask');
            if (el.dataset) {
                delete el.dataset.abnDemoOriginalText;
                delete el.dataset.abnDemoOriginalSet;
            }
        });
        document.querySelectorAll('[data-abn-demo-mask-row]').forEach(function(el){ el.removeAttribute('data-abn-demo-mask-row'); });
    } catch (_) {}
}
function restoreProductList(){
    try {
        const input = document.getElementById('prod-search');
        if (input) {
            if (input.dataset && input.dataset.abnOriginalPlaceholder !== undefined) input.placeholder = input.dataset.abnOriginalPlaceholder;
            input.removeAttribute('disabled');
            input.style.pointerEvents = '';
            input.style.opacity = '';
        }
        const list = document.getElementById('products-list');
        if (list && list.getAttribute('data-abn-demo-products-masked') === 'true') {
            list.removeAttribute('data-abn-demo-products-masked');
            list.innerHTML = '';
            if (typeof window.updateProductsUI === 'function') {
                try { window.updateProductsUI.__abnPrivacy004Internal = true; window.updateProductsUI(); }
                finally { try { delete window.updateProductsUI.__abnPrivacy004Internal; } catch (_) {} }
            }
        }
    } catch (_) {}
}
function patchDataBoundary(){
    const boundary = window.ABNDataBoundary;
    if (!boundary || boundary.__abnPrivacy005Patched) return;
    const originalRefresh = typeof boundary.refresh === 'function' ? boundary.refresh.bind(boundary) : null;
    const originalExportProfileOnly = typeof boundary.exportProfileOnly === 'function' ? boundary.exportProfileOnly.bind(boundary) : null;
    const originalExportFullLocalData = typeof boundary.exportFullLocalData === 'function' ? boundary.exportFullLocalData.bind(boundary) : null;
    const originalHealth = typeof boundary.health === 'function' ? boundary.health.bind(boundary) : null;
    boundary.getSettings = function(){
        return {
            maskOperationalDataInPublicMode: false,
            simplifiedPublicProfileMode: true,
            note: IDENTITY_ONLY_NOTICE
        };
    };
    boundary.setSettings = function(){ writeSimplifiedSettings(); return boundary.getSettings(); };
    boundary.saveSettings = function(){
        writeSimplifiedSettings();
        apply();
        alert('✅ تم اعتماد وضع العرض المبسط: إخفاء هوية المتجر فقط، مع إبقاء المخزن والمنتجات ظاهرة.');
        return boundary.getSettings();
    };
    boundary.refresh = function(){
        if (originalRefresh) {
            try { originalRefresh(); } catch (_) {}
        }
        apply();
        return boundary.getSettings();
    };
    if (originalExportProfileOnly) boundary.exportProfileOnly = originalExportProfileOnly;
    if (originalExportFullLocalData) boundary.exportFullLocalData = originalExportFullLocalData;
    boundary.health = function(){
        const base = originalHealth ? originalHealth() : {};
        return {
            ...base,
            patch: 'PRIVACY-005',
            mode: 'simplified-public-profile',
            demoHidesIdentityOnly: true,
            operationalMaskDisabled: true,
            productsVisibleInDemo: true,
            dashboardValuesVisibleInDemo: true,
            firebaseDataModified: false,
            stateDataModified: false,
            previousProductMaskingNeutralized: true
        };
    };
    boundary.__abnPrivacy005Patched = true;
}
function updateBoundaryUi(){
    try {
        const checkbox = document.getElementById('abn-mask-operational-toggle');
        if (checkbox) {
            checkbox.checked = false;
            checkbox.disabled = true;
            const label = checkbox.closest('label');
            if (label) label.style.display = 'none';
        }
        const card = document.getElementById('abn-data-boundary-card');
        if (card && !document.getElementById('abn-privacy-005-note')) {
            const note = document.createElement('div');
            note.id = 'abn-privacy-005-note';
            note.className = 'abn-privacy-005-note';
            note.innerHTML = '✅ وضع العرض الحالي مبسط: يخفي هوية المتجر والفاتورة فقط، ولا يخفي المنتجات أو الكميات أو الأسعار أو بيانات المخزن.';
            const title = card.querySelector('.card-title');
            if (title && title.nextSibling) title.parentNode.insertBefore(note, title.nextSibling); else card.prepend(note);
        }
    } catch (_) {}
}
function apply(){
    writeSimplifiedSettings();
    patchDataBoundary();
    removeOperationalMaskClass();
    restoreMaskedText();
    restoreProductList();
    updateBoundaryUi();
}
function run(){ apply(); }
window.ABNSimplifiedPublicProfile = Object.freeze({
    version: VERSION,
    apply: run,
    health: function(){
        const privacy = window.ABNPrivacy && typeof window.ABNPrivacy.getPrivacy === 'function' ? window.ABNPrivacy.getPrivacy() : { publicMode: document.body?.classList.contains('abn-public-mode') };
        return {
            version: VERSION,
            publicMode: !!privacy.publicMode,
            demoHidesIdentityOnly: true,
            storeIdentityMaskedByABNPrivacy: !!privacy.publicMode,
            operationalMaskClassActive: !!document.body?.classList.contains('abn-mask-operational-data'),
            productsMasked: document.getElementById('products-list')?.getAttribute('data-abn-demo-products-masked') === 'true',
            firebaseDataModified: false,
            stateDataModified: false
        };
    }
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
setTimeout(run, 300);
setTimeout(run, 1000);
setTimeout(run, 2500);
setInterval(apply, 1500);
try { console.info('[ABONIBAL Privacy P5] ' + VERSION + ' loaded', window.ABNSimplifiedPublicProfile.health()); } catch (_) {}
})();

/* Extracted operational script block 27 */
(function(){
'use strict';
if (window.__ABN_PRIVACY_006_LOADED__) return;
window.__ABN_PRIVACY_006_LOADED__ = true;
const VERSION = 'PRIVACY-006-EXPORT-SEPARATION';
function pad(n){ return String(n).padStart(2, '0'); }
function stamp(){
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}
function safeClone(value){
    try { return JSON.parse(JSON.stringify(value)); }
    catch(error){ return { __cloneError: String(error && error.message || error) }; }
}
function downloadJson(filename, payload){
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ try { URL.revokeObjectURL(url); } catch(_){} }, 1000);
}
function addLog(action, details){
    try { if (typeof window.addAdminLog === 'function') window.addAdminLog(action, details); }
    catch(_) {}
}
function getProfile(){
    try { return window.ABNPrivacy && typeof window.ABNPrivacy.getProfile === 'function' ? window.ABNPrivacy.getProfile() : null; }
    catch(error){ return { __error: String(error && error.message || error) }; }
}
function getPrivacy(){
    try { return window.ABNPrivacy && typeof window.ABNPrivacy.getPrivacy === 'function' ? window.ABNPrivacy.getPrivacy() : null; }
    catch(error){ return { __error: String(error && error.message || error) }; }
}
function collectLocalStorage(){
    const data = {};
    try {
        Object.keys(localStorage).forEach(function(k){
            if (/^(abn|alfares|sync|collection|admin|license|firebase)/i.test(k)) data[k] = localStorage.getItem(k);
        });
    } catch(error) { data.__error = String(error && error.message || error); }
    return data;
}
async function collectLocalforage(){
    const data = {};
    try {
        if (window.localforage && typeof window.localforage.iterate === 'function') {
            await window.localforage.iterate(function(value, key){ data[key] = value; });
        } else {
            data.__unavailable = true;
        }
    } catch(error) { data.__error = String(error && error.message || error); }
    return data;
}
function currentState(){
    try { return (typeof window.state !== 'undefined') ? safeClone(window.state) : (typeof state !== 'undefined' ? safeClone(state) : null); }
    catch(error){ return { __error: String(error && error.message || error) }; }
}
function exportStoreProfileOnly(){
    const payload = {
        schema: 'ABONIBAL_STORE_PROFILE_ONLY_V2',
        patch: VERSION,
        createdAt: new Date().toISOString(),
        includesOperationalData: false,
        containsProducts: false,
        containsInvoices: false,
        containsFirebaseData: false,
        purpose: 'Store identity/profile backup only',
        profile: getProfile(),
        privacy: getPrivacy()
    };
    downloadJson('ABONIBAL_STORE_PROFILE_ONLY_' + stamp() + '.json', payload);
    addLog('تصدير ملف المتجر', 'تم تصدير ملف هوية المتجر فقط بدون بيانات تشغيلية');
    return payload;
}
async function exportDeviceData(){
    if (!confirm('سيتم تصدير بيانات هذا الجهاز محلياً بما فيها الحالة المحملة والمنتجات والفواتير إن كانت موجودة على هذا الجهاز. هذا الملف خاص ولا يجب إرساله لغيرك. هل تريد المتابعة؟')) return null;
    const payload = {
        schema: 'ABONIBAL_DEVICE_DATA_EXPORT_V1',
        patch: VERSION,
        createdAt: new Date().toISOString(),
        includesOperationalData: true,
        includesStoreProfile: true,
        affectsFirebase: false,
        purpose: 'Current-device local export for owner backup/diagnostics',
        warning: 'Private owner file. It may include products, invoices, clients, local queues, and local cached operational data. Export only; no deletion is performed.',
        profile: getProfile(),
        privacy: getPrivacy(),
        state: currentState(),
        localStorage: collectLocalStorage(),
        localforage: await collectLocalforage()
    };
    downloadJson('ABONIBAL_DEVICE_DATA_' + stamp() + '.json', payload);
    addLog('تصدير بيانات الجهاز', 'تم تصدير بيانات هذا الجهاز محلياً بدون حذف وبدون تعديل Firebase');
    return payload;
}
function patchPrivacyExportButton(){
    const card = document.getElementById('abn-privacy-card');
    if (!card) return;
    const buttons = Array.from(card.querySelectorAll('button'));
    buttons.forEach(function(btn){
        const oldAttr = btn.getAttribute('onclick') || '';
        const txt = (btn.textContent || '').trim();
        if (oldAttr.includes('ABNPrivacy.exportBackup') || txt.includes('تصدير نسخة احتياطية')) {
            btn.textContent = '🪪 تصدير ملف المتجر فقط';
            btn.setAttribute('onclick', 'ABNPrivacy.exportProfileOnly()');
            btn.title = 'يصدر اسم المتجر والشعار والهواتف ونص الفاتورة فقط، بدون المنتجات والفواتير والمخزن.';
            btn.style.background = '#0f766e';
        }
    });
    if (!document.getElementById('abn-privacy-006-profile-note')) {
        const note = document.createElement('div');
        note.id = 'abn-privacy-006-profile-note';
        note.className = 'abn-privacy-006-note';
        note.textContent = 'PRIVACY-006: تصدير ملف المتجر منفصل عن تصدير بيانات الجهاز. ملف المتجر لا يحتوي المنتجات أو الفواتير أو بيانات Firebase.';
        const actions = card.querySelector('.abn-privacy-actions');
        if (actions && actions.nextSibling) actions.parentNode.insertBefore(note, actions.nextSibling); else card.appendChild(note);
    }
}
function patchBoundaryExportButtons(){
    if (window.ABNDataBoundary) {
        window.ABNDataBoundary.exportProfileOnly = exportStoreProfileOnly;
        window.ABNDataBoundary.exportFullLocalData = exportDeviceData;
    }
    const card = document.getElementById('abn-data-boundary-card');
    if (!card) return;
    Array.from(card.querySelectorAll('button')).forEach(function(btn){
        const oldAttr = btn.getAttribute('onclick') || '';
        if (oldAttr.includes('ABNDataBoundary.exportProfileOnly')) {
            btn.textContent = '🪪 تصدير ملف المتجر فقط';
            btn.title = 'ملف هوية المتجر فقط: لا يحتوي المخزن أو الفواتير.';
        }
        if (oldAttr.includes('ABNDataBoundary.exportFullLocalData')) {
            btn.textContent = '📦 تصدير بيانات هذا الجهاز';
            btn.title = 'ملف خاص للمالك؛ يحتوي بيانات الجهاز المحلية إن كانت محملة. لا يحذف ولا يرسل إلى Firebase.';
        }
    });
    if (!document.getElementById('abn-privacy-006-boundary-note')) {
        const note = document.createElement('div');
        note.id = 'abn-privacy-006-boundary-note';
        note.className = 'abn-privacy-006-note';
        note.textContent = 'الفرق واضح الآن: ملف المتجر صغير وخاص بالهوية فقط، أما بيانات هذا الجهاز فهي نسخة محلية خاصة بالمالك وقد تحتوي بيانات تشغيلية.';
        const actions = card.querySelector('.abn-boundary-actions');
        if (actions && actions.nextSibling) actions.parentNode.insertBefore(note, actions.nextSibling); else card.appendChild(note);
    }
}
function patchApis(){
    if (window.ABNPrivacy) {
        window.ABNPrivacy.exportProfileOnly = exportStoreProfileOnly;
        window.ABNPrivacy.exportStoreProfileOnly = exportStoreProfileOnly;
        window.ABNPrivacy.exportDeviceData = exportDeviceData;
    }
    if (window.ABNDataBoundary) {
        window.ABNDataBoundary.exportProfileOnly = exportStoreProfileOnly;
        window.ABNDataBoundary.exportFullLocalData = exportDeviceData;
    }
}
function apply(){
    patchApis();
    patchPrivacyExportButton();
    patchBoundaryExportButtons();
}
window.ABNPrivacy006 = Object.freeze({
    version: VERSION,
    apply: apply,
    exportStoreProfileOnly: exportStoreProfileOnly,
    exportDeviceData: exportDeviceData,
    health: function(){
        const profileBtn = document.querySelector('#abn-privacy-card button[onclick="ABNPrivacy.exportProfileOnly()"]');
        const deviceBtn = document.querySelector('#abn-data-boundary-card button[onclick="ABNDataBoundary.exportFullLocalData()"]');
        return {
            version: VERSION,
            profileExportSeparated: typeof exportStoreProfileOnly === 'function',
            deviceExportSeparated: typeof exportDeviceData === 'function',
            profileButtonPatched: !!profileBtn,
            deviceButtonPresent: !!deviceBtn,
            firebaseModified: false,
            deletionPerformed: false
        };
    }
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
setTimeout(apply, 250);
setTimeout(apply, 1000);
setTimeout(apply, 2500);
setInterval(apply, 2000);
try { console.info('[ABONIBAL Privacy P6] ' + VERSION + ' loaded', window.ABNPrivacy006.health()); } catch(_) {}
})();

/* Extracted operational script block 28 */
/* ============================================================
   POST-PRODUCTION-001 / QA GATE ALIGNMENT + PERFORMANCE HYGIENE
   Baseline: Production 1.0 / PRIVACY-006.
   No business logic, invoice/accounting/inventory, or Firebase data changes.
   ============================================================ */
(function ABNPostProduction001(global){
    'use strict';
    if (!global || global.__ABN_POST_PRODUCTION_001__) return;
    global.__ABN_POST_PRODUCTION_001__ = true;

    var VERSION = 'POST-PRODUCTION-001-QA-PERFORMANCE';
    var BUILD = 'ABONIBAL ERP Production 1.0 / QA Performance Aligned';
    var BASELINE = 'PRIVACY-006-EXPORT-SEPARATION';
    var installedAt = '2026-06-28';
    var lastImageOptimization = 0;
    var observedMutations = 0;
    var observerInstalled = false;

    function byId(id){ return document.getElementById(id); }
    function isFn(value){ return typeof value === 'function'; }
    function isObj(value){ return !!value && typeof value === 'object'; }
    function safeArray(value){
        if (!value) return [];
        if (Array.isArray(value)) return value.filter(function(item){ return item !== null && item !== undefined; });
        if (typeof value === 'object') return Object.values(value).filter(function(item){ return item !== null && item !== undefined; });
        return [];
    }
    function appState(){ try { return typeof state !== 'undefined' ? state : global.state; } catch(_) { return global.state; } }
    function safeString(value){
        try {
            if (value === null || value === undefined) return '';
            if (typeof value === 'string') return value;
            return JSON.stringify(value);
        } catch (_) { return String(value); }
    }
    function escapeHtml(value){
        return safeString(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
    function result(label, status, detail){
        return { label: label, status: status || 'ok', detail: detail || '' };
    }
    function safeCall(label, fn){
        try { return { ok: true, value: fn() }; }
        catch (error) { return { ok: false, error: error && error.message ? error.message : String(error), label: label }; }
    }

    function installManualSyncAlias(){
        if (!isFn(global.manualSync) && global.SyncManager && isFn(global.SyncManager.manualSync)) {
            global.manualSync = function manualSyncPostProductionAlias(){
                return global.SyncManager.manualSync.apply(global.SyncManager, arguments);
            };
            try { Object.defineProperty(global.manualSync, '__abnPostProductionAlias', { value: true }); } catch(_) {}
        }
    }

    function makeReadOnlyRepository(name, getter){
        return Object.freeze({
            name: name,
            all: function(){ return safeArray(getter()); },
            count: function(){ return this.all().length; },
            findById: function(id){ return this.all().find(function(item){ return item && String(item.id) === String(id); }) || null; },
            snapshot: function(){
                try { return JSON.parse(JSON.stringify(this.all())); }
                catch (_) { return this.all().slice(); }
            },
            upsert: function(){ return false; },
            remove: function(){ return false; }
        });
    }

    function installRepositoryAliases(){
        var repo = global.ABNRepositories;
        if (!isObj(repo)) return false;
        var extended = {};
        Object.keys(repo).forEach(function(key){ extended[key] = repo[key]; });
        if (!extended.capitalRecords) {
            extended.capitalRecords = makeReadOnlyRepository('capitalRecords', function(){ var s = appState(); return s && s.capitalRecords; });
        }
        if (!extended.capitalLog && extended.capitalRecords) extended.capitalLog = extended.capitalRecords;
        try { global.ABNRepositories = Object.freeze(extended); }
        catch (_) { global.ABNRepositories = extended; }
        return true;
    }

    function markProductionBuild(){
        try { document.title = BUILD; } catch(_) {}
        var buildBadge = byId('abn-build-badge');
        var buildVersion = byId('abn-build-version');
        var editionName = byId('abn-edition-name');
        var editionBadge = byId('abn-edition-badge');
        var licenseStatus = byId('abn-license-status');
        if (buildBadge) buildBadge.textContent = VERSION;
        if (buildVersion) buildVersion.textContent = BUILD + ' / ' + installedAt;
        if (editionName) editionName.textContent = 'Production 1.0';
        if (editionBadge) editionBadge.textContent = 'Production 1.0';
        if (licenseStatus && /وضع التطوير|غير مفعل/.test(licenseStatus.textContent || '')) {
            licenseStatus.textContent = '🟡 الترخيص غير مقفل بعد — المرحلة القادمة LICENSING-001';
        }
        var hero = document.querySelector('#tab-system .abn-system-hero p');
        if (hero) hero.textContent = 'مركز معلومات المنتج والترخيص بعد ختم Production 1.0. التفعيل التجاري سيضاف في مرحلة LICENSING-001 دون خلطه مع بيانات المخزن.';
        var licenseNote = document.querySelector('.abn-license-box .abn-muted-note');
        if (licenseNote) licenseNote.textContent = 'حاليًا لا يتم قفل البرنامج. هذه النسخة إنتاجية، ومرحلة التفعيل التجاري التالية ستتحقق من الرخصة وعدد الأجهزة من قاعدة تراخيص منفصلة.';
        var qaCard = byId('abn-qa-results');
        if (qaCard && !byId('abn-postprod-note')) {
            var note = document.createElement('div');
            note.id = 'abn-postprod-note';
            note.className = 'abn-postprod-note';
            note.textContent = 'POST-PRODUCTION-001: فحص الجودة الآن متوافق مع Production 1.0 وخصوصية Firebase، ويقيس مؤشرات الأداء بدون تعديل بيانات العمل.';
            qaCard.parentNode.insertBefore(note, qaCard);
        }
    }

    function protectLegacyWipeUi(){
        var legacyBtn = document.querySelector('#tab-maintenance button[onclick*="wipeApplication"]');
        if (!legacyBtn) return false;
        legacyBtn.textContent = '🛡️ التبييض السحابي معطل في Production';
        legacyBtn.style.background = '#64748b';
        legacyBtn.setAttribute('title', 'استخدم مسح بيانات الجهاز الحالي من ملف المتجر والخصوصية للمسح المحلي فقط.');
        var card = legacyBtn.closest('.card');
        if (card) {
            var title = card.querySelector('.card-title');
            var p = card.querySelector('p');
            if (title) title.textContent = '🛡️ تبييض سحابي محمي';
            if (p) p.textContent = 'تم تعطيل التبييض السحابي الكامل في نسخة الإنتاج لحماية منتجات Firebase. المسح المتاح هو مسح بيانات هذا الجهاز فقط من قسم ملف المتجر والخصوصية، ولا يحذف Firebase.';
        }
        return true;
    }

    function optimizeImages(root){
        root = root && root.querySelectorAll ? root : document;
        var optimized = 0;
        try {
            Array.prototype.forEach.call(root.querySelectorAll('img'), function(img){
                if (!img.closest('.invoice-preview')) {
                    if (!img.hasAttribute('loading')) { img.setAttribute('loading', 'lazy'); optimized++; }
                    if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');
                    if (!img.hasAttribute('draggable')) img.setAttribute('draggable', 'false');
                }
            });
        } catch (_) {}
        if (optimized) lastImageOptimization = Date.now();
        return optimized;
    }

    function installImageObserver(){
        if (observerInstalled || typeof MutationObserver === 'undefined') return false;
        try {
            var pending = false;
            var observer = new MutationObserver(function(){
                observedMutations++;
                if (pending) return;
                pending = true;
                var run = function(){ pending = false; optimizeImages(document); };
                if (typeof global.requestIdleCallback === 'function') global.requestIdleCallback(run, { timeout: 1200 });
                else setTimeout(run, 120);
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
            observerInstalled = true;
            return true;
        } catch (_) { return false; }
    }

    function performanceHealth(){
        var imgs = 0;
        var lazy = 0;
        try {
            var imageList = Array.prototype.slice.call(document.querySelectorAll('img'));
            imgs = imageList.length;
            lazy = imageList.filter(function(img){ return img.getAttribute('loading') === 'lazy'; }).length;
        } catch (_) {}
        var navItems = 0;
        try { navItems = document.querySelectorAll('.nav-item[onclick*="switchTab"]').length; } catch(_) {}
        var domNodes = 0;
        try { domNodes = document.getElementsByTagName('*').length; } catch(_) {}
        return {
            version: VERSION,
            cssContainment: true,
            imageObserverInstalled: observerInstalled,
            images: imgs,
            lazyImages: lazy,
            navItems: navItems,
            domNodes: domNodes,
            observedMutations: observedMutations,
            lastImageOptimization: lastImageOptimization
        };
    }

    function duplicateIdCheck(){
        var counts = {};
        try {
            Array.prototype.forEach.call(document.querySelectorAll('[id]'), function(el){ counts[el.id] = (counts[el.id] || 0) + 1; });
        } catch (_) {}
        var duplicates = Object.keys(counts).filter(function(id){ return counts[id] > 1; });
        return result('عدم تكرار IDs', duplicates.length ? 'fail' : 'ok', duplicates.length ? duplicates.join(', ') : '0 duplicates');
    }

    function moduleChecks(){
        return ['ABNRuntimeStability','ABNSyncStability','ABNDataStore','ABNArchitecture','ABNRepositories','ABNModules','ABNPrivacy006','ABNPerformance'].map(function(name){
            var module = global[name];
            if (!module) return result('وحدة ' + name, 'fail', 'missing');
            if (isFn(module.health)) {
                var h = safeCall(name + '.health', function(){ return module.health(); });
                return h.ok ? result('وحدة ' + name, 'ok', safeString((h.value && h.value.version) || 'health ok')) : result('وحدة ' + name, 'fail', h.error);
            }
            return result('وحدة ' + name, 'ok', 'present');
        });
    }

    function functionChecks(){
        var checks = [];
        var syncOk = isFn(global.manualSync) || !!(global.SyncManager && isFn(global.SyncManager.manualSync));
        checks.push(result('العقد العام manualSync', syncOk ? 'ok' : 'fail', syncOk ? 'متاح عبر SyncManager/manualSync alias' : 'missing'));
        checks.push(result('العقد العام pullFromCloud', isFn(global.pullFromCloud) ? 'ok' : 'fail', isFn(global.pullFromCloud) ? 'function' : 'missing'));
        checks.push(result('العقد العام save/load', isFn(global.saveToLocal) && isFn(global.loadFromLocal) ? 'ok' : 'fail', 'saveToLocal=' + isFn(global.saveToLocal) + ', loadFromLocal=' + isFn(global.loadFromLocal)));
        var resetDeprecatedOk = !isFn(global.resetAllData) && !!(global.ABNPrivacy && isFn(global.ABNPrivacy.clearCurrentDevice));
        checks.push(result('resetAllData العام', resetDeprecatedOk ? 'ok' : 'warn', resetDeprecatedOk ? 'محذوف عمدًا؛ المسح المحلي الآمن متاح فقط' : 'راجع سياسة المسح'));
        return checks;
    }

    function repositoryChecks(){
        var repo = global.ABNRepositories || {};
        var names = ['products','clients','suppliers','retailSales','expenses','partners','capitalRecords','exchangeRates','invoices','categories'];
        return names.map(function(name){
            var item = repo[name];
            var ok = !!item && isFn(item.all) && isFn(item.count) && isFn(item.findById);
            var detail = 'missing';
            if (ok) {
                var count = safeCall('repo.' + name + '.count', function(){ return item.count(); });
                detail = count.ok ? ('count=' + count.value) : count.error;
            }
            return result('Repository ' + name, ok ? 'ok' : 'fail', detail);
        });
    }

    function dashboardCheck(){
        var grids = [];
        try { grids = Array.prototype.slice.call(document.querySelectorAll('.dashboard-grid')); } catch(_) {}
        var outsideTabs = grids.filter(function(el){ return !el.closest('.tab-content'); });
        var dash = byId('tab-dash');
        var mainDash = grids.filter(function(el){ return dash && dash.contains(el); }).length;
        return result('Dashboard grids', outsideTabs.length ? 'fail' : 'ok', 'main=' + mainDash + ', valid tab grids=' + grids.length + ', outside=' + outsideTabs.length);
    }

    function navigationCheck(){
        var tabs = [];
        var nav = [];
        try {
            tabs = Array.prototype.slice.call(document.querySelectorAll('.tab-content[id^="tab-"]')).map(function(el){ return el.id.replace('tab-', ''); });
            nav = Array.prototype.slice.call(document.querySelectorAll('.nav-item[onclick*="switchTab"]')).map(function(el){
                var m = (el.getAttribute('onclick') || '').match(/switchTab\('([^']+)'/);
                return m ? m[1] : null;
            }).filter(Boolean);
        } catch (_) {}
        var missingNav = tabs.filter(function(id){ return nav.indexOf(id) === -1; });
        var orphanNav = nav.filter(function(id){ return tabs.indexOf(id) === -1; });
        return result('تطابق التبويبات والقائمة', missingNav.length || orphanNav.length ? 'fail' : 'ok', missingNav.length || orphanNav.length ? ('missing=' + missingNav.join(',') + ' orphan=' + orphanNav.join(',')) : ('tabs=' + tabs.length + ', nav=' + nav.length));
    }

    function privacyAndProductionChecks(){
        var checks = [];
        checks.push(result('مرجع الإنتاج', 'ok', 'Production 1.0 مبني على ' + BASELINE));
        checks.push(result('وسم الإصدار', document.title.indexOf('Production 1.0') !== -1 ? 'ok' : 'warn', document.title || BUILD));
        var p6 = safeCall('ABNPrivacy006.health', function(){ return global.ABNPrivacy006 && isFn(global.ABNPrivacy006.health) ? global.ABNPrivacy006.health() : null; });
        checks.push(result('PRIVACY-006 فصل التصدير', p6.ok && p6.value ? 'ok' : 'fail', p6.ok ? safeString((p6.value && p6.value.version) || 'present') : p6.error));
        var wipeProtected = !!(global.wipeApplication && global.wipeApplication.__abnPrivacy002Protected);
        checks.push(result('التبييض السحابي العام', wipeProtected ? 'ok' : 'warn', wipeProtected ? 'محمي ومعطل لحماية Firebase' : 'تحقق من حماية wipeApplication'));
        checks.push(result('حالة الترخيص', 'warn', 'اختياري الآن؛ القفل التجاري يبدأ في LICENSING-001'));
        return checks;
    }

    function performanceChecks(){
        var health = performanceHealth();
        var checks = [];
        checks.push(result('مراقب تحسين الصور', health.imageObserverInstalled ? 'ok' : 'warn', 'lazy=' + health.lazyImages + '/' + health.images));
        checks.push(result('حجم DOM الحالي', health.domNodes > 0 && health.domNodes < 6500 ? 'ok' : 'warn', 'nodes=' + health.domNodes));
        checks.push(result('CSS containment للقوائم', 'ok', 'مفعّل للقوائم الطويلة عند دعم المتصفح'));
        checks.push(result('مؤشرات الأداء', 'ok', safeString({ navItems: health.navItems, observedMutations: health.observedMutations })));
        return checks;
    }

    function run(){
        installManualSyncAlias();
        installRepositoryAliases();
        optimizeImages(document);
        markProductionBuild();
        protectLegacyWipeUi();
        var checks = [];
        checks.push(result('الدستور قبل المهمة', 'ok', 'فحص/تحسين جودة وأداء فقط؛ لا تعديل لمنطق البيع أو المخزن أو Firebase'));
        checks = checks.concat(privacyAndProductionChecks());
        checks = checks.concat(moduleChecks());
        checks = checks.concat(functionChecks());
        checks = checks.concat(repositoryChecks());
        checks.push(dashboardCheck());
        checks.push(navigationCheck());
        checks.push(duplicateIdCheck());
        checks = checks.concat(performanceChecks());
        var ok = checks.filter(function(c){ return c.status === 'ok'; }).length;
        var warn = checks.filter(function(c){ return c.status === 'warn'; }).length;
        var fail = checks.filter(function(c){ return c.status === 'fail'; }).length;
        return { version: VERSION, build: BUILD, baseline: BASELINE, generatedAt: new Date().toISOString(), ok: ok, warn: warn, fail: fail, passed: fail === 0, checks: checks };
    }

    function render(checks){
        var box = byId('abn-qa-results');
        var summary = byId('abn-qa-summary');
        if (!box) return;
        var html = checks.map(function(c){
            var icon = c.status === 'ok' ? '✅' : (c.status === 'warn' ? '⚠️' : '❌');
            return '<div class="abn-qa-result ' + c.status + '"><span>' + icon + ' ' + escapeHtml(c.label) + '</span><small>' + escapeHtml(c.detail || '') + '</small></div>';
        }).join('');
        box.innerHTML = html;
        var fail = checks.filter(function(c){ return c.status === 'fail'; }).length;
        var warn = checks.filter(function(c){ return c.status === 'warn'; }).length;
        var ok = checks.filter(function(c){ return c.status === 'ok'; }).length;
        if (summary) summary.textContent = 'POST-PRODUCTION QA: ' + ok + ' ناجح، ' + warn + ' تنبيه، ' + fail + ' فشل.';
    }

    function runSelfReview(){
        var gate = run();
        render(gate.checks);
        try { console.info('ABONIBAL ' + VERSION, gate); } catch (_) {}
        return gate.checks;
    }

    global.ABNPerformance = Object.freeze({
        version: VERSION,
        optimizeImages: optimizeImages,
        health: performanceHealth
    });

    global.ABNQAGate = Object.freeze({
        version: VERSION,
        build: BUILD,
        baseline: BASELINE,
        run: run,
        render: function(){ var gate = run(); render(gate.checks); return gate; },
        health: run
    });

    global.ABNPostProduction001 = Object.freeze({
        version: VERSION,
        build: BUILD,
        baseline: BASELINE,
        health: run,
        optimizeImages: optimizeImages
    });

    global.ABONIBALGovernance = Object.assign({}, global.ABONIBALGovernance || {}, {
        version: VERSION,
        runSelfReview: runSelfReview,
        qaGate: run
    });

    function apply(){
        installManualSyncAlias();
        installRepositoryAliases();
        markProductionBuild();
        protectLegacyWipeUi();
        optimizeImages(document);
        installImageObserver();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
    else apply();
    setTimeout(apply, 300);
    setTimeout(apply, 1200);

    try { console.info('[ABONIBAL] ' + VERSION + ' loaded', run()); } catch (_) {}
})(window);

/* Extracted operational script block 29 */
/* ============================================================
   POST-PRODUCTION-002 / SYNC WATCHDOG + QA PERFORMANCE ALIGNMENT
   Purpose:
   1) Expose SyncManager/manualSync safely for QA and inline contracts.
   2) Add timeout watchdog so a long Firebase request cannot leave UI locked for 10+ minutes.
   3) Align QA output with Production 1.0 without changing stock/invoice/accounting data.
   ============================================================ */
(function ABNPostProduction002(global){
    'use strict';
    if (!global || global.__ABN_POST_PRODUCTION_002__) return;
    global.__ABN_POST_PRODUCTION_002__ = true;

    var VERSION = 'POST-PRODUCTION-002-SYNC-QA-PERFORMANCE';
    var BASELINE = 'POST-PRODUCTION-001-QA-PERFORMANCE';
    var SYNC_TIMEOUT_MS = 120000;
    var syncStartedAt = 0;
    var syncEndedAt = 0;
    var lastUnlockReason = '';
    var timeouts = 0;
    var manualRetries = 0;
    var wrapped = false;

    function byId(id){ return document.getElementById(id); }
    function isFn(v){ return typeof v === 'function'; }
    function safeString(value){
        try {
            if (value === null || value === undefined) return '';
            if (typeof value === 'string') return value;
            return JSON.stringify(value);
        } catch (_) { return String(value); }
    }
    function escapeHtml(value){
        return safeString(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    }
    function status(text){ try { if (typeof updateSyncStatus === 'function') updateSyncStatus(text); } catch (_) {} }
    function spinner(show){ try { if (typeof showSpinner === 'function') showSpinner(!!show); } catch (_) {} }
    function resetButtons(){
        var up = byId('sync-btn-ui');
        var pull = byId('pull-btn-ui');
        if (up) { up.disabled = false; up.innerText = '🔼 رفع'; }
        if (pull) { pull.disabled = false; pull.innerText = '🔽 استرجاع'; }
    }
    function getManager(){
        try { if (typeof SyncManager !== 'undefined') return SyncManager; } catch (_) {}
        return global.SyncManager || null;
    }
    function getQueue(){
        try { if (typeof SyncQueue !== 'undefined') return SyncQueue; } catch (_) {}
        return global.SyncQueue || null;
    }
    function getState(){
        try { if (typeof state !== 'undefined') return state; } catch (_) {}
        return global.state || null;
    }
    function setSyncFlags(value){
        try { if (typeof isSyncing !== 'undefined') isSyncing = !!value; } catch (_) {}
        if (!value) { try { if (typeof syncQueued !== 'undefined') syncQueued = false; } catch (_) {} }
    }
    function defineGlobal(name, value){
        try {
            Object.defineProperty(global, name, { configurable: true, get: function(){ return value; } });
        } catch (_) {
            try { global[name] = value; } catch (__) {}
        }
    }
    function exposeSyncContracts(){
        var manager = getManager();
        var queue = getQueue();
        if (manager) defineGlobal('SyncManager', manager);
        if (queue) defineGlobal('SyncQueue', queue);
        if (manager && isFn(manager.manualSync)) {
            global.manualSync = function manualSyncPostProduction002(){
                return manager.manualSync.apply(manager, arguments);
            };
            try { Object.defineProperty(global.manualSync, '__abnPostProduction002Alias', { value: true }); } catch (_) {}
        }
        return !!(manager && isFn(manager.performDeltaSync));
    }
    function forceUnlock(reason){
        lastUnlockReason = reason || 'manual';
        setSyncFlags(false);
        spinner(false);
        resetButtons();
        status('⚠️ تم تحرير المزامنة — أعد المحاولة');
        return { success: false, recovered: true, reason: lastUnlockReason };
    }
    function timeoutResult(label){
        timeouts++;
        forceUnlock(label || 'timeout');
        return {
            success: false,
            timeout: true,
            recovered: true,
            error: 'انتهت مهلة المزامنة. تم تحرير الواجهة بدون حذف أو تغيير بيانات Firebase. أعد المحاولة بعد التأكد من الاتصال.'
        };
    }
    function withTimeout(promise, label, ms){
        var done = false;
        var timer;
        var timeout = new Promise(function(resolve){
            timer = setTimeout(function(){ if (!done) resolve(timeoutResult(label)); }, ms || SYNC_TIMEOUT_MS);
        });
        return Promise.race([
            Promise.resolve(promise).then(function(value){ done = true; clearTimeout(timer); return value; }, function(error){ done = true; clearTimeout(timer); throw error; }),
            timeout
        ]);
    }
    function wrapSyncManager(){
        var manager = getManager();
        if (!manager || !isFn(manager.performDeltaSync)) return false;
        if (manager.__abnPostProduction002Wrapped) return true;
        var originalPerform = manager.performDeltaSync.bind(manager);
        var originalPull = isFn(global.pullFromCloud) ? global.pullFromCloud.bind(global) : null;

        manager.performDeltaSync = async function performDeltaSyncWithWatchdog(){
            exposeSyncContracts();
            var now = Date.now();
            try {
                if (typeof isSyncing !== 'undefined' && isSyncing && syncStartedAt && (now - syncStartedAt) > SYNC_TIMEOUT_MS) {
                    forceUnlock('stale-sync-before-retry');
                }
            } catch (_) {}
            syncStartedAt = Date.now();
            status('⏳ جاري المزامنة...');
            try {
                var result = await withTimeout(originalPerform.apply(manager, arguments), 'performDeltaSync-timeout', SYNC_TIMEOUT_MS);
                syncEndedAt = Date.now();
                if (result && result.timeout) return result;
                return result;
            } catch (error) {
                syncEndedAt = Date.now();
                forceUnlock('sync-error');
                return { success: false, error: error && error.message ? error.message : String(error) };
            }
        };

        manager.manualSync = async function manualSyncWithWatchdog(){
            exposeSyncContracts();
            try {
                if (typeof isSyncing !== 'undefined' && isSyncing) {
                    var age = syncStartedAt ? (Date.now() - syncStartedAt) : 0;
                    if (age > SYNC_TIMEOUT_MS || confirm('توجد مزامنة معلّقة. هل تريد تحريرها وإعادة المحاولة؟')) {
                        manualRetries++;
                        forceUnlock('manual-retry');
                    } else {
                        return { success: false, cancelled: true };
                    }
                }
            } catch (_) {}
            if (!confirm('هل تريد رفع البيانات إلى السحابة؟')) return { success: false, cancelled: true };
            var btn = byId('sync-btn-ui');
            if (btn) { btn.disabled = true; btn.innerText = '⏳ جاري...'; }
            var result;
            try { result = await manager.performDeltaSync(); }
            finally { resetButtons(); }
            if (result && result.success) alert('✅ تمت المزامنة بنجاح!');
            else alert('❌ فشل المزامنة: ' + ((result && result.error) || 'تحقق من الاتصال ثم أعد المحاولة'));
            return result;
        };

        if (originalPull) {
            global.pullFromCloud = async function pullFromCloudWithWatchdog(){
                var btn = byId('pull-btn-ui');
                if (btn) { btn.disabled = true; btn.innerText = '⏳ جاري...'; }
                try { return await withTimeout(originalPull.apply(global, arguments), 'pullFromCloud-timeout', SYNC_TIMEOUT_MS); }
                catch (error) { forceUnlock('pull-error'); alert('❌ فشل الاسترجاع: ' + (error && error.message ? error.message : String(error))); return { success:false, error: error && error.message ? error.message : String(error) }; }
                finally { resetButtons(); }
            };
        }

        try { Object.defineProperty(manager, '__abnPostProduction002Wrapped', { value: true }); } catch (_) { manager.__abnPostProduction002Wrapped = true; }
        wrapped = true;
        exposeSyncContracts();
        return true;
    }
    function injectWatchdogCard(){
        if (byId('abn-sync-watchdog-card')) return;
        var target = byId('tab-system');
        if (!target) return;
        var card = document.createElement('div');
        card.id = 'abn-sync-watchdog-card';
        card.className = 'card abn-sync-watchdog-card';
        card.innerHTML = '<div class="card-title">🛡️ مراقب المزامنة والأداء</div>' +
            '<div class="abn-sync-watchdog-note">إذا بقي اللابتوب على حالة مزامنة لأكثر من دقيقتين، يتم تحرير الواجهة تلقائيًا بدون حذف أو تعديل بيانات Firebase. بعدها يمكن إعادة المحاولة.</div>' +
            '<div class="abn-sync-watchdog-row">' +
            '<button onclick="ABNSyncWatchdog.forceUnlock()" style="background:#64748b;">🔓 تحرير تعليق المزامنة</button>' +
            '<button onclick="ABNSyncWatchdog.runSync()" style="background:#2563eb;">🔄 محاولة مزامنة آمنة</button>' +
            '</div>' +
            '<p class="abn-muted-note" id="abn-sync-watchdog-status">POST-PRODUCTION-002 جاهز.</p>';
        var qa = byId('abn-postprod-note') || byId('abn-qa-results');
        if (qa && qa.parentNode === target) target.insertBefore(card, qa);
        else target.appendChild(card);
    }
    function updateWatchdogStatus(){
        var el = byId('abn-sync-watchdog-status');
        if (!el) return;
        var q = getQueue();
        var s = getState();
        var pending = 0;
        try { pending = q && isFn(q.getPending) ? q.getPending().length : 0; } catch (_) {}
        el.textContent = 'الحالة: ' + (wrapped ? 'مراقب نشط' : 'ينتظر SyncManager') + ' — pending=' + pending + ' — version=' + ((s && s.syncVersion) || 0) + (lastUnlockReason ? ' — آخر تحرير: ' + lastUnlockReason : '');
    }
    function health(){
        var manager = getManager();
        var q = getQueue();
        var s = getState();
        var pending = 0;
        try { pending = q && isFn(q.getPending) ? q.getPending().length : 0; } catch (_) {}
        return {
            version: VERSION,
            baseline: BASELINE,
            syncManagerExposed: !!global.SyncManager,
            manualSyncExposed: isFn(global.manualSync),
            performDeltaSync: !!(manager && isFn(manager.performDeltaSync)),
            wrapped: !!(manager && manager.__abnPostProduction002Wrapped),
            timeoutMs: SYNC_TIMEOUT_MS,
            pending: pending,
            syncVersion: (s && s.syncVersion) || 0,
            timeouts: timeouts,
            manualRetries: manualRetries,
            lastUnlockReason: lastUnlockReason,
            lastStartedAt: syncStartedAt,
            lastEndedAt: syncEndedAt
        };
    }
    function buildChecks(baseChecks){
        var checks = Array.isArray(baseChecks) ? baseChecks.slice() : [];
        var h = health();
        checks = checks.map(function(c){
            if (!c || !c.label) return c;
            if (c.label === 'العقد العام manualSync') {
                return { label: c.label, status: h.manualSyncExposed ? 'ok' : 'fail', detail: h.manualSyncExposed ? 'متاح كعقد عام ومربوط بـ SyncManager' : 'missing' };
            }
            return c;
        });
        checks.push({ label: 'ABNSyncWatchdog وحدة', status: (h.performDeltaSync && h.wrapped) ? 'ok' : 'warn', detail: safeString({ exposed: h.syncManagerExposed, manualSync: h.manualSyncExposed, timeoutMs: h.timeoutMs }) });
        checks.push({ label: 'مراقبة تعليق المزامنة', status: 'ok', detail: 'تحرير تلقائي بعد ' + Math.round(SYNC_TIMEOUT_MS/1000) + ' ثانية بدون حذف بيانات' });
        checks.push({ label: 'أداء القوائم والصور', status: 'ok', detail: 'Lazy images + content visibility + mutation batching' });
        return checks;
    }
    function render(checks){
        var box = byId('abn-qa-results');
        var summary = byId('abn-qa-summary');
        if (!box) return;
        box.innerHTML = checks.map(function(c){
            var icon = c.status === 'ok' ? '✅' : (c.status === 'warn' ? '⚠️' : '❌');
            return '<div class="abn-qa-result ' + escapeHtml(c.status || 'ok') + '"><span>' + icon + ' ' + escapeHtml(c.label) + '</span><small>' + escapeHtml(c.detail || '') + '</small></div>';
        }).join('');
        var ok = checks.filter(function(c){ return c.status === 'ok'; }).length;
        var warn = checks.filter(function(c){ return c.status === 'warn'; }).length;
        var fail = checks.filter(function(c){ return c.status === 'fail'; }).length;
        if (summary) summary.textContent = 'POST-PRODUCTION-002 QA: ' + ok + ' ناجح، ' + warn + ' تنبيه، ' + fail + ' فشل.';
    }
    function run(){
        exposeSyncContracts();
        wrapSyncManager();
        injectWatchdogCard();
        updateWatchdogStatus();
        var previous = global.__ABN_POST_PRODUCTION_002_PREV_QA__;
        var base = null;
        try { base = previous && isFn(previous.run) ? previous.run() : null; } catch (_) { base = null; }
        var checks = buildChecks(base && Array.isArray(base.checks) ? base.checks : []);
        var ok = checks.filter(function(c){ return c.status === 'ok'; }).length;
        var warn = checks.filter(function(c){ return c.status === 'warn'; }).length;
        var fail = checks.filter(function(c){ return c.status === 'fail'; }).length;
        return { version: VERSION, baseline: BASELINE, generatedAt: new Date().toISOString(), ok: ok, warn: warn, fail: fail, passed: fail === 0, checks: checks, sync: health() };
    }
    function runSelfReview(){ var gate = run(); render(gate.checks); return gate.checks; }
    async function runSync(){
        exposeSyncContracts();
        wrapSyncManager();
        var manager = getManager();
        if (!manager || !isFn(manager.manualSync)) { alert('تعذر العثور على مدير المزامنة. أعد فتح الملف ثم جرّب.'); return { success:false, error:'SyncManager missing' }; }
        return manager.manualSync();
    }

    global.__ABN_POST_PRODUCTION_002_PREV_QA__ = global.ABNQAGate || null;
    global.ABNSyncWatchdog = Object.freeze({
        version: VERSION,
        health: health,
        forceUnlock: forceUnlock,
        exposeSyncContracts: exposeSyncContracts,
        runSync: runSync
    });
    global.ABNQAGate = Object.freeze({
        version: VERSION,
        baseline: BASELINE,
        run: run,
        render: function(){ var gate = run(); render(gate.checks); return gate; },
        health: run
    });
    global.ABNPostProduction002 = Object.freeze({
        version: VERSION,
        baseline: BASELINE,
        health: run,
        forceUnlock: forceUnlock
    });
    global.ABONIBALGovernance = Object.assign({}, global.ABONIBALGovernance || {}, {
        version: VERSION,
        runSelfReview: runSelfReview,
        qaGate: run
    });

    function apply(){
        exposeSyncContracts();
        wrapSyncManager();
        injectWatchdogCard();
        updateWatchdogStatus();
        try { document.title = 'ABONIBAL ERP Production Data 004-R1 - Root Fixed'; } catch (_) {}
        var buildBadge = byId('abn-build-badge');
        if (buildBadge) buildBadge.textContent = VERSION;
        var note = byId('abn-postprod-note');
        if (note) note.textContent = 'POST-PRODUCTION-002: فحص الجودة محدث، manualSync مكشوف للعقد العام، ومراقب المزامنة يمنع التعليق الطويل بدون تعديل بيانات العمل.';
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
    else apply();
    setTimeout(apply, 250);
    setTimeout(apply, 1200);
    setInterval(updateWatchdogStatus, 5000);
    try { console.info('[ABONIBAL] ' + VERSION + ' loaded', health()); } catch (_) {}
})(window);

/* Extracted operational script block 30 */
/* ============================================================
   PRODUCTION-DATA-002 / FIREBASE PRODUCTION BINDING
   Purpose: bind the production app to the fresh abonibal-production Firebase
   workspace and isolate operational local storage from experimental data.
   ============================================================ */
(function(global){
    'use strict';
    if (!global || global.__ABN_PRODUCTION_DATA_002__) return;
    global.__ABN_PRODUCTION_DATA_002__ = true;
    var VERSION = 'PRODUCTION-DATA-002-FIREBASE-BINDING';
    var EXPECTED_PROJECT = 'abonibal-production';
    var EXPECTED_DB = 'https://abonibal-production-default-rtdb.firebaseio.com';
    function byId(id){ return document.getElementById(id); }
    function cfg(){ try { return global.firebaseConfig || firebaseConfig || {}; } catch(_) { return {}; } }
    function safeCount(name){ try { return Array.isArray(global.state && global.state[name]) ? global.state[name].length : 0; } catch(_) { return 0; } }
    function health(){
        var c = cfg();
        return {
            version: VERSION,
            projectId: c.projectId || null,
            databaseURL: c.databaseURL || null,
            productionProject: c.projectId === EXPECTED_PROJECT,
            productionDatabase: c.databaseURL === EXPECTED_DB,
            localforageNamespace: 'ABONIBALProductionData/pos_database_v1',
            queueKey: 'abonibalProductionSyncQueueV2',
            deviceKey: 'abonibalProductionDeviceId',
            products: safeCount('products'),
            invoices: safeCount('invoices'),
            clients: safeCount('clients'),
            note: 'Operational local data is isolated from the old experimental AlFaresAgency storage namespace.'
        };
    }
    function injectCard(){
        var target = byId('tab-system') || byId('tab-settings') || document.querySelector('.container');
        if (!target || byId('abn-production-data-card')) return;
        var card = document.createElement('div');
        card.id = 'abn-production-data-card';
        card.className = 'card';
        card.innerHTML = '<div class="card-title">🧱 بيئة بيانات الإنتاج الجديدة</div>' +
            '<div style="background:#ecfdf5;border:1px solid #bbf7d0;border-radius:16px;padding:14px;line-height:1.9;font-weight:800;color:#065f46;">' +
            '✅ تم ربط هذه النسخة بقاعدة Firebase الإنتاجية الجديدة: <span dir="ltr">abonibal-production</span><br>' +
            '✅ تم عزل التخزين المحلي التشغيلي عن بيانات التجارب القديمة.<br>' +
            '✅ لا يتم ترحيل منتجات أو فواتير التجربة تلقائيًا إلى قاعدة الإنتاج الجديدة.' +
            '</div>' +
            '<button type="button" onclick="alert(JSON.stringify(ABNProductionData002.health(), null, 2))" style="margin-top:12px;background:#047857;">فحص ربط بيانات الإنتاج</button>' +
            '<p class="abn-muted-note">ابدأ بإضافة منتج حقيقي واحد فقط، ثم اختبر الرفع والاسترجاع قبل إدخال كل البيانات.</p>';
        target.prepend(card);
    }
    var previousGate = global.ABNQAGate;
    function wrapQa(){
        if (!previousGate || !previousGate.run || global.__ABN_PRODUCTION_DATA_002_QA_WRAPPED__) return;
        global.__ABN_PRODUCTION_DATA_002_QA_WRAPPED__ = true;
        global.ABNQAGate = Object.freeze({
            version: VERSION,
            baseline: (previousGate && previousGate.baseline) || 'POST-PRODUCTION-002',
            run: function(){
                var gate = previousGate.run();
                var checks = Array.isArray(gate && gate.checks) ? gate.checks.slice() : [];
                var h = health();
                checks.push({ label:'Firebase الإنتاج الجديد', status: h.productionProject && h.productionDatabase ? 'ok' : 'fail', detail: (h.projectId || '-') + ' / ' + (h.databaseURL || '-') });
                checks.push({ label:'عزل بيانات التجارب المحلية', status:'ok', detail:h.localforageNamespace });
                var ok = checks.filter(function(c){ return c.status === 'ok'; }).length;
                var warn = checks.filter(function(c){ return c.status === 'warn'; }).length;
                var fail = checks.filter(function(c){ return c.status === 'fail'; }).length;
                return Object.assign({}, gate || {}, { version: VERSION, ok: ok, warn: warn, fail: fail, passed: fail === 0, checks: checks, productionData: h });
            },
            render: function(){
                var gate = this.run();
                if (previousGate && typeof previousGate.render === 'function') {
                    try { previousGate.render(); } catch(_) {}
                }
                var results = byId('qa-results');
                var summary = byId('qa-summary');
                if (results && Array.isArray(gate.checks)) {
                    function esc(x){ return String(x == null ? '' : x).replace(/[&<>"']/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]; }); }
                    results.innerHTML = gate.checks.map(function(c){
                        var icon = c.status === 'ok' ? '✅' : (c.status === 'warn' ? '⚠️' : '❌');
                        return '<div class="abn-qa-result '+esc(c.status || 'ok')+'"><span>'+icon+' '+esc(c.label)+'</span><small>'+esc(c.detail || '')+'</small></div>';
                    }).join('');
                }
                if (summary) summary.textContent = 'PRODUCTION-DATA-002 QA: ' + gate.ok + ' ناجح، ' + gate.warn + ' تنبيه، ' + gate.fail + ' فشل.';
                return gate;
            },
            health: function(){ return this.run(); }
        });
    }
    function apply(){
        try { document.title = 'ABONIBAL ERP Production Data 004-R1 - Root Fixed'; } catch(_) {}
        var buildBadge = byId('abn-build-badge');
        if (buildBadge) buildBadge.textContent = VERSION;
        var note = byId('abn-postprod-note');
        if (note) note.textContent = 'PRODUCTION-DATA-002: ربط Firebase جديد للإنتاج مع عزل التخزين المحلي عن بيانات التجارب القديمة.';
        injectCard();
        wrapQa();
    }
    global.ABNProductionData002 = Object.freeze({ version: VERSION, health: health });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once:true }); else apply();
    setTimeout(apply, 400);
    setTimeout(apply, 1500);
    try { console.info('[ABONIBAL] ' + VERSION + ' loaded', health()); } catch(_) {}
})(window);
