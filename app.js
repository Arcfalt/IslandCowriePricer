// Directory will be filled dynamically from Universalis endpoints.
let DIRECTORY = []; // combined list of regions, datacenters, and worlds

const LABELS = {
	buy: "Cowrie Cost",
	profit: "Difference",
	factor: "Gil per Cowrie",
	source: "Source",
	scope: "Scope",
	min: "Cheapest Listing",
	recent: "Most Recent Sold",
	avg: "Average Sale Price",
	vel: "Daily Sale Velocity",
	world: "World",
	dc: "Datacenter",
	region: "Region",
};

// Externalized item data, populated at startup
/** @type {Record<string, {buy:number, name:string}>} */
let ITEM_DATA = {};
let ITEMS = '';

// Avoid repetition for Universalis endpoints
const API_BASE = 'https://universalis.app/api/v2';
// Asset version for cache-busting edited static files (e.g., item-data.json)
const ASSET_VERSION = '1'; // bump when item-data.json changes

const status = document.getElementById('status');
const results = document.getElementById('results');
const datacenterInput = document.getElementById('datacenter');
const fetchBtn = document.getElementById('fetchBtn');
const sourceSelect = document.getElementById('sourceSelect');
const scopeSelect = document.getElementById('scopeSelect');
const sortSelect = document.getElementById('sortSelect');

// Persist and restore user selections
const controlSpecs = [
	['datacenter', 'input'],
	['sourceSelect', 'change'],
	['scopeSelect', 'change'],
	['sortSelect', 'change'],
];
controlSpecs.forEach(([id, evt]) => {
	const el = document.getElementById(id);
	const saved = localStorage.getItem(id);
	if (saved !== null) el.value = saved;
	el.addEventListener(evt, () => localStorage.setItem(id, el.value));
});

// Build datalist from a simple string array
function populateDCList(list) {
	const dl = document.getElementById('dcList');
	if (!dl) return;
	dl.innerHTML = '';
	const frag = document.createDocumentFragment();
	list.forEach((name) => {
		const opt = document.createElement('option');
		opt.value = name;
		frag.appendChild(opt);
	});
	dl.appendChild(frag);
}

async function loadItems() {
	try {
		const res = await fetch(`item-data.json?v=${ASSET_VERSION}`, { cache: 'no-store' });
		if (!res.ok) throw new Error('Item data HTTP ' + res.status);
		const json = await res.json();
		if (!json || typeof json !== 'object') throw new Error('Invalid item data');
		ITEM_DATA = json;
		ITEMS = Object.keys(ITEM_DATA).join(',');
	} catch (e) {
		console.error('Failed to load item-data.json', e);
		status.textContent = 'Error loading item data';
		throw e;
	}
}

// Fetch regions/DCs/worlds and construct a combined list
async function loadDirectory() {
	try {
		const [dcRes, worldRes] = await Promise.all([
			fetch(`${API_BASE}/data-centers`),
			fetch(`${API_BASE}/worlds`),
		]);
		if (!dcRes.ok || !worldRes.ok)
			throw new Error('Directory HTTP ' + (dcRes.status || '') + '/' + (worldRes.status || ''));
		const [dcArr, worldArr] = await Promise.all([dcRes.json(), worldRes.json()]);
		// Map world id to name
		const worldById = new Map(worldArr.map((w) => [w.id, w.name]));
		// Collect unique regions, dcs and world names in the desired order: Region -> DC -> Worlds
		const seenRegion = new Set();
		const seenDC = new Set();
		const seenWorld = new Set();
		const out = [];
		for (const dc of dcArr) {
			if (dc.region && !seenRegion.has(dc.region)) {
				seenRegion.add(dc.region);
				out.push(dc.region);
			}
			if (dc.name && !seenDC.has(dc.name)) {
				seenDC.add(dc.name);
				out.push(dc.name);
			}
			for (const wid of dc.worlds || []) {
				const wname = worldById.get(wid);
				if (wname && !seenWorld.has(wname)) {
					seenWorld.add(wname);
					out.push(wname);
				}
			}
		}
		DIRECTORY = out;
		populateDCList(DIRECTORY);
	} catch (e) {
		console.warn('Directory load failed:', e);
		// fallback to current input only
		populateDCList([datacenterInput.value || 'Faerie']);
	}
}

fetchBtn.addEventListener('click', run);
sourceSelect.addEventListener('change', render);
scopeSelect.addEventListener('change', render);
sortSelect.addEventListener('change', render);

const nfGil = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const nfQty = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const nfFactor = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let baseRows = [];
let ctrl; // AbortController for in-flight requests

function pick(obj, scope, field) {
	if (!obj) return null;
	const src = obj?.[scope] ?? null;
	return src ? src[field] ?? null : null;
}

async function run() {
	results.innerHTML = '';
	status.textContent = 'Fetching...';
	// prevent overlaps and long hangs
	if (ctrl) ctrl.abort();
	ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 15000);
	// disable controls during fetch
	const controls = [fetchBtn, datacenterInput, sourceSelect, scopeSelect, sortSelect];
	controls.forEach((el) => (el.disabled = true));
	try {
		const dc = datacenterInput.value.trim() || 'Faerie';
		const url = `${API_BASE}/aggregated/${encodeURIComponent(dc)}/${ITEMS}`;
		const res = await fetch(url, { signal: ctrl.signal });
		if (!res.ok) throw new Error('HTTP ' + res.status);
		const data = await res.json();

		// Precompute all scopes and sources once for each row
		baseRows = (data.results || []).map((r) => {
			const id = r.itemId;
			const meta = ITEM_DATA[id] || ITEM_DATA[String(id)];
			const buy = Number.isFinite(meta?.buy) && meta.buy >= 0 ? meta.buy : null;
			const name = meta?.name || `Item ${id}`;
			const minObj = r?.nq?.minListing;
			const recentObj = r?.nq?.recentPurchase;
			const avgObj = r?.nq?.averageSalePrice;
			const velObj = r?.nq?.dailySaleVelocity;

			const scopes = ['world', 'dc', 'region'];
			const v = Object.fromEntries(
				scopes.map((s) => [
					s,
					{
						min: pick(minObj, s, 'price'),
						recent: pick(recentObj, s, 'price'),
						avg: pick(avgObj, s, 'price'),
						vel: pick(velObj, s, 'quantity'),
					},
				]),
			);

			return { id, name, buy, v };
		});

		render();
		status.textContent = `Fetched ${baseRows.length} items from ${datacenterInput.value || 'Faerie'}`;
	} catch (err) {
		console.error(err);
		status.textContent = 'Error: ' + err.message;
	} finally {
		clearTimeout(t);
		ctrl = null;
		controls.forEach((el) => (el.disabled = false));
	}
}

function computeDerived(row, sourceKey, scope) {
	const srcVal = row.v?.[scope]?.[sourceKey] ?? null;
	const buy = row.buy;
	const validBuy = Number.isFinite(buy) && buy > 0;
	const profit = Number.isFinite(srcVal) && Number.isFinite(buy) ? srcVal - buy : null;
	const factor = Number.isFinite(srcVal) && validBuy ? srcVal / buy : null;
	return { srcVal, profit, factor };
}

// Reusable DOM nodes keyed by item id
const nodeById = new Map();
const refsById = new Map();

function buildRowNode(row) {
	const li = document.createElement('li');

	// Title row with link and pills
	const title = document.createElement('div');
	const strong = document.createElement('strong');
	const a = document.createElement('a');
	a.href = `https://universalis.app/market/${row.id}`;
	a.target = '_blank';
	a.rel = 'noopener noreferrer';
	a.textContent = row.name;
	strong.appendChild(a);
	title.appendChild(strong);

	const pillFactor = document.createElement('span');
	pillFactor.className = 'pill';
	const pillBuy = document.createElement('span');
	pillBuy.className = 'pill';
	const pillProfit = document.createElement('span');
	pillProfit.className = 'pill';
	title.append(pillFactor, pillBuy, pillProfit);
	li.appendChild(title);

	// Detail rows
	const dMin = document.createElement('div');
	dMin.className = 'muted';
	const dRecent = document.createElement('div');
	dRecent.className = 'muted';
	const dAvg = document.createElement('div');
	dAvg.className = 'muted';
	const dVel = document.createElement('div');
	dVel.className = 'muted';
	li.append(dMin, dRecent, dAvg, dVel);

	refsById.set(row.id, { a, pillFactor, pillBuy, pillProfit, dMin, dRecent, dAvg, dVel });
	return li;
}

function updateRowNode(li, row, scope) {
	const r = refsById.get(row.id);
	if (!r) return;
	r.a.textContent = row.name;
	r.a.href = `https://universalis.app/market/${row.id}`;
	r.pillFactor.textContent = `${LABELS.factor}: ${row.factor != null ? nfFactor.format(row.factor) : 'n/a'}`;
	r.pillBuy.textContent = `${LABELS.buy}: ${row.buy != null ? nfGil.format(row.buy) : 'n/a'}`;
	r.pillProfit.textContent = `${LABELS.profit}: ${row.profit != null ? nfGil.format(row.profit) : 'n/a'}`;
	// Profit coloring
	r.pillProfit.classList.remove('pos', 'neg');
	if (Number.isFinite(row.profit)) {
		if (row.profit > 0) r.pillProfit.classList.add('pos');
		else if (row.profit < 0) r.pillProfit.classList.add('neg');
	}

	const vv = row.v?.[scope] || {};
	r.dMin.textContent = `${LABELS.min}: ${Number.isFinite(vv.min) ? nfGil.format(vv.min) : 'n/a'}`;
	r.dRecent.textContent = `${LABELS.recent}: ${Number.isFinite(vv.recent) ? nfGil.format(vv.recent) : 'n/a'}`;
	r.dAvg.textContent = `${LABELS.avg}: ${Number.isFinite(vv.avg) ? nfGil.format(vv.avg) : 'n/a'}`;
	r.dVel.textContent = `${LABELS.vel}: ${Number.isFinite(vv.vel) ? nfQty.format(vv.vel) : 'n/a'}`;
}

function render() {
	const sourceKey = sourceSelect.value || 'min';
	const scope = scopeSelect.value || 'world';
	const sortMode = sortSelect.value || 'factor';

	const rows = baseRows.map((r) => ({ ...r, ...computeDerived(r, sourceKey, scope) }));

	rows.sort((a, b) => {
		const getKey = (r) => (sortMode === 'profit' ? r.profit : r.factor);
		const av = getKey(a);
		const bv = getKey(b);
		const an = Number.isFinite(av) ? av : -Infinity;
		const bn = Number.isFinite(bv) ? bv : -Infinity;
		if (bn !== an) return bn - an;
		return String(a.name).localeCompare(String(b.name));
	});

	// Cleanup nodes for items no longer present
	const currentIds = new Set(rows.map((r) => r.id));
	for (const [id, li] of Array.from(nodeById.entries())) {
		if (!currentIds.has(id)) {
			if (li && li.parentNode) li.parentNode.removeChild(li);
			nodeById.delete(id);
			refsById.delete(id);
		}
	}

	const frag = document.createDocumentFragment();
	rows.forEach((row) => {
		let li = nodeById.get(row.id);
		if (!li) {
			li = buildRowNode(row);
			nodeById.set(row.id, li);
		}
		updateRowNode(li, row, scope);
		frag.appendChild(li);
	});
	results.replaceChildren(frag);
}

// Init sequence
datacenterInput.placeholder = 'Type or choose...';
fetchBtn.disabled = true;
Promise.all([loadDirectory(), loadItems()])
	.then(() => {
		status.textContent = 'Ready';
		fetchBtn.disabled = false;
	})
	.catch(() => {
		/* status already set if items failed */
	});
